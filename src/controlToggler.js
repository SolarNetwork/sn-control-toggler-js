import { request as xhrRequest } from 'd3-request';
import { queue } from 'd3-queue';
import { 
	AuthorizationV2Builder,
	dateParser,
	HttpContentType,
	HttpHeaders,
	HttpMethod,
	InstructionState,
	InstructionStates,
	Logger as log,
	NodeDatumUrlHelper,
 } from 'solarnetwork-api-core';

const SetControlParameterInstructionName = 'SetControlParameter';

/**
 * Instruction states that indicate a toggle instruction is in-flight.
 * @type {Set}
 * @private
 */
const InstructionActiveStates = new Set([
	InstructionStates.Queued,
    InstructionStates.Received,
	InstructionStates.Executing
]);

/**
 * Instruction states that indicate a toggle instruction is comleted or declined.
 * @type {Set}
 * @private
 */
const InstructionFinishedStates = new Set([
	InstructionStates.Completed,
	InstructionStates.Declined,
]);

/**
 * @typedef {Object} ControlDatum
 * @property {string} created the datum date
 * @property {string} sourceId the control ID
 * @property {number} val the control value, essentially `0` or `1`
 */

 /**
  * @typedef {Object} InstructionParameter
  * @property {string} name the parameter name
  * @property {string} value the parameter value
  */

 /**
  * @typedef {Object} Instruction
  * @property {number} id the unique ID of the instruction
  * @property {string} created the instruction date
  * @property {string} status an `InstructionStatus` name value
  * @property {InstructionParameter[]} [parameters] the instruction parameters
  */

/**
 * Manage the state of a boolean control switch using SolarNetwork `SetControlParameter` instructions.
 */
class ControlToggler {
    /**
     * Constructor.
     * @param {NodeInstructionUrlHelper} urlHelper the URL helper to use, which must support node instructions with the `NodeInstructionUrlHelperMixin`
     *                    and be configured with the `nodeId` property for the node to be managed
	 * @param {AuthorizationV2Builder} authBuilder the auth builder to authenticate requests with; the required credentials
	 *                                             must be set appropriately
     * @param {string} [controlId=/power/switch/1] the ID of the control to manage
	 * @param {NodeDatumUrlHelper} [queryUrlHelper] a URL helper for accessing node datum via SolarQuery; if not provided one
	 *                                              will be created using the `environment` from `urlHelper`
     */
    constructor(urlHelper, authBuilder, controlId, queryUrlHelper) {

        /**
         * The URL helper to use, which must support node instructions with the `NodeInstructionUrlHelperMixin`
         * and be configured with the `nodeId` property for the node to be managed.
         * @type {NodeInstructionUrlHelper}
         */
		this.instructionUrlHelper = urlHelper;
		
		/**
		 * The auth builder to use for authorizing requets. The credentials must be configured to support
		 * posting instructions and viewing the data for the configured `controlId`.
		 * @type {AuthorizationV2Builder}
		 */
		this.authBuilder = authBuilder || new AuthorizationV2Builder(null, urlHelper ? urlHelper.environment : undefined);

        /**
         * The control ID to manage.
         * @type {string}
         */
		this.controlId = controlId;
		
		/**
		 * The SolarQuery URL helper.
		 * @type {NodeDatumUrlHelper}
		 */
		this.queryUrlHelper = (queryUrlHelper || new NodeDatumUrlHelper(urlHelper.environment));

		// force the nodeId / sourceId to our controlId
		this.queryUrlHelper.nodeId = urlHelper.nodeId;
		this.queryUrlHelper.sourceId = controlId;

        /**
         * A timer ID for refreshing the local state.
         * @type {number}
         * @private
         */
		this.timer = null;
		
        /**
         * The last known instruction status. The `val` property indicates the control value.
         * @type {ControlDatum}
         * @private
         */
        this.lastKnownDatum = undefined;

        /**
         * The last known instruction object.
         * @type {Instruction}
         * @private
         */
        this.lastKnownInstruction = undefined;

        /**
         * The refresh rate, in milliseconds.
         * Defaults to 20 seconds.
         * @type {number}
         */
        this.refreshMs = 20000;

        /**
         * The refresh rate, in milliseconds, when a toggle instruction is queued.
         * Defaults to 5 seconds.
         * @type {number}
         */
        this.pendingRefreshMs = 5000;

        /**
         * A callback function, which is called after the state of the control changes.
         * The `this` reference will be set to this object. If an error has occurred,
         * the error will be passed as the first argument.
         * 
         * @type {function}
         */
        this.callback = undefined;
    }

	notifyDelegate(error) {
        const callback = this.callback;
		if ( callback !== undefined ) {
			try {
				callback.call(self, error);
			} catch ( callbackError ) {
				log.error('Error in callback: %s', callbackError);
			}
		}
	}

    /**
     * Find an active `SetControlParameterInstruction` for the configured `controlId`.
     * 
     * @param {Instruction[]} data array of instructions
     * @returns {Instruction} the active instruction, or `undefined`
     * @private
     */
    getActiveInstruction(data) {
		if ( !Array.isArray(data) || data.length === 0 ) {
			return undefined;
        }
        const controlId = this.controlId;
		var instruction = data.reduce((prev, curr) => {
			if ( curr.topic === SetControlParameterInstructionName && Array.isArray(curr.parameters)
				&& curr.parameters.length > 0 && curr.parameters[0].name === controlId
				&& (prev === undefined || prev.created < curr.created) ) {
				return curr;
			}
			return prev;
		}, undefined);
		if ( instruction !== undefined ) {
			log.debug('Active instruction for %d found in state %s (set control %s to %s)', 
				this.instructionUrlHelper.nodeId, instruction.state, controlId, instruction.parameters[0].value);
		}
		return instruction;
	}
    
    /**
     * Get the last know instruction state, if available.
     * @returns {InstructionState} the last known instruction state, or `undefined`
     * @private
     */
	lastKnownInstructionState() {
        const lastKnownInstruction = this.lastKnownInstruction;
		return (lastKnownInstruction === undefined ? undefined 
			: InstructionState.valueOf(lastKnownInstruction.state));
	}
    
    /**
     * Get the last known instruction value, e.g. the state of the control.
     * @returns {number} the last know value of the control (0 or 1), or `undefined`
     * @private
     */
	lastKnownInstructionValue() {
        const lastKnownInstruction = this.lastKnownInstruction;
		return (lastKnownInstruction === undefined ? undefined 
			: Number(lastKnownInstruction.parameters[0].value));
	}

    /**
     * Calculate the refresh rate to use.
     * @returns {number} the refresh rate to use, in milliseconds
     * @private
     */
	currentRefreshMs() {
        return (InstructionActiveStates.has(this.lastKnownInstructionState())
			? this.refreshMs
			: this.pendingRefreshMs);
	}
	
	/**
	 * Return the value from either the `controlStatus` or the first parameter value of an `instruction`,
	 * whichever is valid and more recent.
	 * 
	 * @param {ControlDatum} controlDatum a control status object
	 * @param {Instruction} instruction  an instruction object
	 * @returns {number} the control status value
	 * @private
	 */
	mostRecentValue(controlDatum, instruction) {
		if ( !instruction || InstructionStates.Declined.equals(instruction.status) ) {
			return (controlDatum ? controlDatum.val : undefined);
		} else if ( !controlDatum ) {
			return Number(instruction.parameters[0].value);
		}
		// return the newer value
		const statusDate = dateParser(controlDatum.created);
		const instructionDate = dateParser(instruction.created);
		return (statusDate.getTime() > instructionDate.getTime() 
			? controlDatum.val 
			: Number(instruction.parameters[0].value));
	}
	
	/**
	 * Handle the authentication for a request.
	 * 
	 * <p>If the `url` contains query parameters and the `GET`` request is **not** used,
	 * the `HttpContentType.FORM_URLENCODED` content type will be assumed.</p>
	 * 
	 * @param {XMLHttpRequest} request the XHR
	 * @param {string} method the HTTP method
	 * @param {string} url the URL
	 * @param {string} [contentType] a HTTP content type to use
	 * @returns {void}
	 * @private
	 */
	handleRequestAuth(request, method, url, contentType) {
		const now = new Date();
		this.authBuilder.reset().date(now).snDate(true)
			.method(method)
			.url(url);
		if ( contentType ) {
			this.authBuilder.contentType(contentType);
		}
		request.setRequestHeader(HttpHeaders.X_SN_DATE, this.authBuilder.requestDateHeaderValue);
		request.setRequestHeader(HttpHeaders.AUTHORIZATION, this.authBuilder.buildWithSavedKey());
	}

	/**
	 * Defer a JSON request on a queue.
	 * 
	 * <p>If the `url` contains query parameters and the `GET`` method is **not** used,
	 * the query parameters will be removed fom the URL and posted on the request body
	 * instead, using the `HttpContentType.FORM_URLENCODED` content type.</p>
	 * 
	 * @param {Queue} q the queue to defer with 
	 * @param {string} method the HTTP method
	 * @param {string} url the URL
	 * @returns {ControlToggler} this object
	 * @private
	 */
	deferJsonRequestWithAuth(q, method, url) {
		let queryIndex = -1;
		let reqData = undefined;
		let contentType = undefined;
		if ( method !== HttpMethod.GET ) {
			queryIndex = url.indexOf('?');
			reqData = url.substring(queryIndex + 1);
			contentType = HttpContentType.FORM_URLENCODED_UTF8;
		}
		const req = xhrRequest(queryIndex >= 0 ? url.substring(0, queryIndex) : url)
			.mimeType(HttpContentType.APPLICATION_JSON)
			.on('beforesend', (request) => {
				this.handleRequestAuth(request, method, url, contentType);
			});
		q.defer(req.send, method, reqData);
		return this;
	}
    
	/**
	 * Get or set the desired control value.
	 * 
	 * @param {number} [desiredValue] the control value to set
	 * @returns {number|ControlToggler} when called as a getter, the last known control value; when called as a
	 *                                  setter, this object
	 */
	value(desiredValue) {
		if ( !arguments.length ) return (this.lastKnownDatum === undefined ? undefined : this.lastKnownDatum.val);
		if ( !this.authBuilder.signingKeyValid ) {
			throw new Error('Valid credentials not configured');
		}
        const controlId = this.controlId;
		const instrUrlHelper = this.instructionUrlHelper;
		const q = queue();
		var currentValue = (this.lastKnownDatum === undefined ? undefined : this.lastKnownDatum.val);
		var pendingState = this.lastKnownInstructionState();
		var pendingValue = this.lastKnownInstructionValue();
		if ( pendingState === InstructionStates.Queued && pendingValue !== desiredValue ) {
			// cancel the pending instruction
			log.debug('Canceling %d pending control %s switch to %s', instrUrlHelper.nodeId, controlId,  pendingValue);
            const cancelInstructionUrl = instrUrlHelper.updateInstructionStateUrl(
				this.lastKnownInstruction.id, InstructionStates.Declined);
			this.deferJsonRequestWithAuth(q, HttpMethod.POST, cancelInstructionUrl);
			this.lastKnownInstruction = undefined;
			pendingState = undefined;
			pendingValue = undefined;
		}
		if ( currentValue !== desiredValue && pendingValue !== desiredValue ) {
			log.debug('Request %d to change control %s to %d',  instrUrlHelper.nodeId, controlId, desiredValue);
            const queueInstructionUrl = instrUrlHelper.queueInstructionUrl(SetControlParameterInstructionName, [
				{name: controlId, value: String(desiredValue)}
			]);
			this.deferJsonRequestWithAuth(q, HttpMethod.POST, queueInstructionUrl);
		}
		q.awaitAll((error, results) => {
			if ( error ) {
				log.error('Error updating %d control toggler %s: %s', instrUrlHelper.nodeId, controlId, error.status);
				this.notifyDelegate(error);
				return;
			}
			if ( results.length < 1 ) {
				// we queued nothing
				return;
			}
			results.forEach((e, i) => {
				if ( e.responseText ) {
					results[i] = JSON.parse(e.responseText);
				}
			});
			const cancelResult =results[0];
			// note == null check here, which handles either undefined or null
			if ( cancelResult.data == null && cancelResult.success === true ) {
				// it was cancelled
				this.lastKnownInstruction = undefined;
			}
			const instructionResult = results[results.length - 1].data;
			if ( !(instructionResult == null) ) {
				// this is the last know instruction now
				this.lastKnownInstruction = instructionResult;
			}
			
			// invoke the client callback so they know the instruction state has changed
			this.notifyDelegate();
			
			// reset timer to start polling at pendingRefreshMs rate
			if ( this.timer ) {
				this.stop();
				this.start(this.currentRefreshMs());
			}
		});
		return this;
	}
	
    /**
     * Refresh the control state from SolarNetwork.
     * @returns {ControlToggler} this object
     */
	update() {
		if ( !this.authBuilder.signingKeyValid ) {
			throw new Error('Valid credentials not configured');
		}
		const controlId = this.controlId;
		const instrUrlHelper = this.instructionUrlHelper;
		const queryUrlHelper = this.queryUrlHelper;
		const q = queue();

		// query for most recently available datum for control to check control value
		const mostRecentUrl = queryUrlHelper.mostRecentDatumUrl();
		this.deferJsonRequestWithAuth(q, HttpMethod.GET, mostRecentUrl);

		// query for pending instructions to see if we have an in-flight SetControlParameter on the go already
		const viewPendingUrl = instrUrlHelper.viewPendingInstructionsUrl();
		this.deferJsonRequestWithAuth(q, HttpMethod.GET, viewPendingUrl);

		if ( this.lastKnownInstruction && !InstructionFinishedStates.has(this.lastKnownInstructionState()) ) {
			// also refresh this specific instruction, to know when it goes to Completed so we can
			// assume the control value has changed, even if the mostRecent data lags behind
			const viewInstructionUrl = instrUrlHelper.viewInstructionUrl(this.lastKnownInstruction.id);
			this.deferJsonRequestWithAuth(q, HttpMethod.GET, viewInstructionUrl);
		}

		q.awaitAll((error, results) => {
			if ( error ) {
				log.error('Error querying %d control toggler %s status: %s', instrUrlHelper.nodeId, controlId, error.status);
				this.notifyDelegate(error);
			} else {
				results.forEach((e, i) => {
					if ( e.responseText ) {
						results[i] = JSON.parse(e.responseText);
					}
				});
				let mostRecentDatum, active, executing;
				if ( results.length > 0 ) {
					mostRecentDatum = results[0];
				}
				if ( results.length > 1 ) {
					active = results[1];
				}
				if ( results.length > 2 ) {
					executing = results[2];
				}
				// get current status of control via most recent datum
				/** @type {ControlDatum} */
				let mostRecentControlDatum = undefined;
				if ( mostRecentDatum.data && Array.isArray(mostRecentDatum.data.results) ) {
					mostRecentControlDatum = mostRecentDatum.data.results.find((e) => e.sourceId === controlId);
				}
				
				// get active (pending) instruction (if any)
				const execInstruction = (executing ? executing.data : undefined);
				const pendingInstruction = (active ? this.getActiveInstruction(active.data) : undefined);
				const newValue = (this.mostRecentValue(mostRecentControlDatum, execInstruction ? execInstruction 
								: pendingInstruction ? pendingInstruction : this.lastKnownInstruction));
				const currValue = this.value();
				if ( newValue !== currValue ) {
					log.debug('Current %d control %s value is %s',  instrUrlHelper.nodeId, controlId, (newValue !== undefined ? newValue : 'N/A'));
					this.lastKnownDatum = mostRecentControlDatum;
					if ( this.lastKnownDatum && !pendingInstruction ) {
						this.lastKnownDatum.val = newValue; // force this, because instruction value might be newer than status value
					}
					this.lastKnownInstruction = (execInstruction ? execInstruction : pendingInstruction);
					
					// invoke the client callback so they know the data has been updated
					this.notifyDelegate();
				}
			}
			
			// if timer was defined, keep going as if interval set
			if ( this.timer !== undefined ) {
				this.timer = setTimeout(this.update, this.currentRefreshMs());
			}
		});

		return this;
	}

	/**
	 * Start automatically updating the status of the configured control.
	 * 
	 * @param {number} [when=20] an optional offset in milliseconds to start at
	 * @returns {ControlToggler} this object
	 */
	start(when) {
        const timer = this.timer;
		if ( !timer ) {
			this.timer = setTimeout(this.update, (when || 20));
		}
		return this;
	}
	
	/**
	 * Stop automatically updating the status of the configured control.
	 * 
	 * @returns {ControlToggler} this object
	 */
	stop() {
        const timer = this.timer;
		if ( timer ) {
			clearTimeout(timer);
			this.timer = null;
		}
		return this;
	}
}

export default ControlToggler;
