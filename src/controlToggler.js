import { jsonRequest } from 'd3-request';
import { queue } from 'd3-queue';
import { 
	AuthorizationV2Builder,
	dateParser,
	DatumFilter,
	HttpContentType,
	HttpHeaders,
	HttpMethod,
	InstructionState,
	InstructionStates,
	Logger as log,
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
 * Manage the state of a boolean control switch using SolarNetwork `SetControlParameter` instructions.
 */
class ControlToggler {
    /**
     * Constructor.
     * @param {module:solarnetwork-api-core:UrlHelper} urlHelper the URL helper to use, which must support node instructions with the `NodeInstructionUrlHelperMixin`
     *                    and be configured with the `nodeId` property for the node to be managed
	 * @param {AuthorizationV2Builder} authBuilder the auth builder to authenticate requests with; the required credentials
	 *                                             must be set appropriately
     * @param {string} [controlId=/power/switch/1] the ID of the control to manage
     */
    constructor(urlHelper, authBuilder, controlId) {

        /**
         * The URL helper to use, which must support node instructions with the `NodeInstructionUrlHelperMixin`
         * and be configured with the `nodeId` property for the node to be managed.
         * @member {module:solarnetwork-api-core:UrlHelper}
		 * @mixes module:solarnetwork-api-core:NodeInstructionUrlHelperMixin
         */
		this.nodeUrlHelper = urlHelper;
		
		/**
		 * The auth builder to use for authorizing requets. The credentials must be configured to support
		 * posting instructions and viewing the data for the configured `controlId`.
		 * @member {AuthorizationV2Builder}
		 */
		this.authBuilder = authBuilder || new AuthorizationV2Builder(null, urlHelper ? urlHelper.environment : undefined);

        /**
         * The control ID to manage.
         * @member {string}
         */
        this.controlId = controlId;

        /**
         * A timer ID for refreshing the local state.
         * @member {number}
         * @private
         */
        this.timer = null;

        /**
         * The last known instruction status. The `val` property indicates the control value.
         * @member {object}
         * @private
         */
        this.lastKnownStatus = null;

        /**
         * The last known instruction object.
         * @member {object}
         * @private
         */
        this.lastKnownInstruction = null;

        this.lastHadCredentials = null;

        /**
         * The refresh rate, in milliseconds.
         * Defaults to 20 seconds.
         * @member {number}
         */
        this.refreshMs = 20000;

        /**
         * The refresh rate, in milliseconds, when a toggle instruction is queued.
         * Defaults to 5 seconds.
         * @member {number}
         */
        this.pendingRefreshMs = 5000;

        /**
         * A callback function, which is called after the state of the control changes.
         * The `this` reference will be set to this object. If an error has occurred,
         * the error will be passed as the first argument.
         * 
         * @type {function}
         */
        this.callback = null;
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
     * @param {object[]} data array of instructions
     * @returns {object} the active instruction, or `undefined`
     * @private
     */
    getActiveInstruction(data) {
		if ( !Array.isArray(data) || data.length === 0 ) {
			return undefined;
        }
        const controlId = this.controlId;
		var instruction = data.reduce((prev, curr) => {
			if ( curr.topic === SetControlParameterInstruction && Array.isArray(curr.parameters)
				&& curr.parameters.length > 0 && curr.parameters[0].name === controlId
				&& (prev === undefined || prev.created < curr.created) ) {
				return curr;
			}
			return prev;
		}, undefined);
		if ( instruction !== undefined ) {
			log.debug('Active instruction for %d found in state %s (set control %s to %s)', 
				this.nodeUrlHelper.nodeId, instruction.state, controlId, instruction.parameters[0].value);
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
	 * Get or set the desired control value.
	 * 
	 * @param {number} [desiredValue] the control value to set
	 * @returns {number|ControlToggler} when called as a getter, the last known control value; when called as a
	 *                                  setter, this object
	 */
	value(desiredValue) {
		if ( !arguments.length ) return (this.lastKnownStatus === undefined ? undefined : this.lastKnownStatus.val);
        const controlId = this.controlId;
        const nodeUrlHelper = this.nodeUrlHelper;
		const q = queue();
		var currentValue = (this.lastKnownStatus === undefined ? undefined : this.lastKnownStatus.val);
		var pendingState = this.lastKnownInstructionState();
		var pendingValue = this.lastKnownInstructionValue();
		if ( pendingState === InstructionStates.Queued && pendingValue !== desiredValue ) {
			// cancel the pending instruction
			log.debug('Canceling %d pending control %s switch to %s', 
				nodeUrlHelper.nodeId, controlId,  pendingValue);
            
            /** @type {string} */
            const cancelInstructionUrl = nodeUrlHelper.updateInstructionStateUrl(
				this.lastKnownInstruction.id, InstructionStates.Declined.name);
			const queryIdx = cancelInstructionUrl.indexOf('?');
            const cancelInstructionReq = jsonRequest.request(cancelInstructionUrl.substring(0, queryIdx))
                .contentType(HttpContentType.FORM_URLENCODED)
				.on('beforesend', (request) => {
					const now = new Date();
					this.authBuilder.reset().date(now).snDate(true)
						.method(HttpMethod.POST)
						.contentType(HttpContentType.FORM_URLENCODED)
						.url(cancelInstructionUrl);
					request.setRequestHeader(HttpHeaders.X_SN_DATE, this.authBuilder.requestDateHeaderValue);
					request.setRequestHeader(HttpHeaders.AUTHORIZATION, this.authBuilder.buildWithSavedKey());
				});
			q.defer(cancelInstructionReq.send, HttpMethod.POST, cancelInstructionUrl.substring(queryIdx + 1));
			this.lastKnownInstruction = undefined;
			pendingState = undefined;
			pendingValue = undefined;
		}
		if ( currentValue !== desiredValue && pendingValue !== desiredValue ) {
			log.debug('Request %d to change control %s to %d', 
				nodeUrlHelper.nodeId, controlId, desiredValue);
            /** @type {string} */
            const queueInstructionUrl = nodeUrlHelper.queueInstructionUrl(SetControlParameterInstructionName, [
				{name: controlId, value: String(desiredValue)}
			]);
			const queryIdx = queueInstructionUrl.indexOf('?');
            const queueInstructionReq = jsonRequest.request(queueInstructionUrl.substring(0, queryIdx))
                .contentType(HttpContentType.FORM_URLENCODED)
				.on('beforesend', (request) => {
					const now = new Date();
					this.authBuilder.reset().date(now).snDate(true)
						.method(HttpMethod.POST)
						.contentType(HttpContentType.FORM_URLENCODED)
						.url(queueInstructionUrl);
					request.setRequestHeader(HttpHeaders.X_SN_DATE, this.authBuilder.requestDateHeaderValue);
					request.setRequestHeader(HttpHeaders.AUTHORIZATION, this.authBuilder.buildWithSavedKey());
				});
			q.defer(queueInstructionReq.send, HttpMethod.POST, queueInstructionUrl.substring(queryIdx + 1));
		}
		q.awaitAll((error, results) => {
			if ( error ) {
				log.error('Error updating {2} control toggler {0}: {1}', controlId, error.status, this.nodeUrlHelper.nodeId);
				this.notifyDelegate(error);
				return;
			}
			if ( results.length < 1 ) {
				// we queued nothing
				return;
			}
			const cancelResult = results[0];
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
	 * Return either the `controlStatus` value or the first parameter value of an `instruction`,
	 * whichever is valid and more recent.
	 * 
	 * @param {object} controlStatus a control status object
	 * @param {object} instruction  an instruction object
	 * @returns {number} the control status value
	 * @private
	 */
	mostRecentValue(controlStatus, instruction) {
		if ( !instruction || InstructionStates.Declined.equals(instruction.status) ) {
			return (controlStatus ? controlStatus.val : undefined);
		} else if ( !controlStatus ) {
			return Number(instruction.parameters[0].value);
		}
		// return the newer value
		const statusDate = dateParser(controlStatus.created);
		const instructionDate = dateParser(instruction.created);
		return (statusDate.getTime() > instructionDate.getTime() 
			? controlStatus.val 
			: Number(instruction.parameters[0].value));
	}
    
    /**
     * Refresh the control state from SolarNetwork.
     * @returns {ControlToggler} this object
     * @private
     */
	update() {
		const controlId = this.controlId;
		const nodeUrlHelper = this.nodeUrlHelper;
		const q = queue();
		const controlFilter = new DatumFilter();
		controlFilter.sourceId = controlId;

		const mostRecentUrl = nodeUrlHelper.mostRecentDatumUrl(controlFilter);
		const mostRecentReq = jsonRequest.request(mostRecentUrl)
			.mimeType(HttpContentType.APPLICATION_JSON)
			.on('beforesend', (request) => {
				const now = new Date();
				this.authBuilder.reset().date(now).snDate(true)
					.method(HttpMethod.GET)
					.url(mostRecentUrl);
				request.setRequestHeader(HttpHeaders.X_SN_DATE, this.authBuilder.requestDateHeaderValue);
				request.setRequestHeader(HttpHeaders.AUTHORIZATION, this.authBuilder.buildWithSavedKey());
			});
		q.defer(mostRecentReq.get);

		if ( this.authBuilder.signingKeyValid ) {
			const viewPendingUrl = nodeUrlHelper.viewPendingInstructionsUrl();
			const viewPendingReq = jsonRequest.request(viewPendingUrl)
				.mimeType(HttpContentType.APPLICATION_JSON)
				.on('beforesend', (request) => {
					const now = new Date();
					this.authBuilder.reset().date(now).snDate(true)
						.method(HttpMethod.GET)
						.url(viewPendingUrl);
					request.setRequestHeader(HttpHeaders.X_SN_DATE, this.authBuilder.requestDateHeaderValue);
					request.setRequestHeader(HttpHeaders.AUTHORIZATION, this.authBuilder.buildWithSavedKey());
				});
			q.defer(viewPendingReq.get);
			if ( this.lastKnownInstruction && InstructionFinishedStates.has(this.lastKnownInstructionState()) ) {
				// also refresh this specific instruction, to know when it goes to Completed so we can
				// assume the control value has changed, even if the mostRecent data lags behind
				const viewInstructionUrl = nodeUrlHelper.viewInstructionsUrl(this.lastKnownInstruction.id);
				const viewInstructionReq = jsonRequest.request(viewInstructionUrl)
					.mimeType(HttpContentType.APPLICATION_JSON)
					.on('beforesend', (request) => {
						const now = new Date();
						this.authBuilder.reset().date(now).snDate(true)
							.method(HttpMethod.GET)
							.url(viewInstructionUrl);
						request.setRequestHeader(HttpHeaders.X_SN_DATE, this.authBuilder.requestDateHeaderValue);
						request.setRequestHeader(HttpHeaders.AUTHORIZATION, this.authBuilder.buildWithSavedKey());
					});
				q.defer(viewInstructionReq.get);
			}
		}
		q.await(function(error, status, active, executing) {
			if ( error ) {
				log.log('Error querying control toggler {0} for {2} status: {1}', controlId, error.status, nodeUrlHelper.nodeId);
				this.notifyDelegate(error);
			} else {
				// get current status of control
				var i, len;
				var controlStatus = undefined;
				if ( status.data && Array.isArray(status.data.results) ) {
					for ( i = 0, len = status.data.results.length; i < len && controlStatus === undefined; i++ ) {
						if ( status.data.results[i].sourceId === controlId ) {
							controlStatus = status.data.results[i];
						}
					}
				}
				
				// get current instruction (if any)
				var execInstruction = (executing ? executing.data : undefined);
				var pendingInstruction = (active ? this.getActiveInstruction(active.data) : undefined);
				var newValue = (this.mostRecentValue(controlStatus, execInstruction ? execInstruction 
								: pendingInstruction ? pendingInstruction : this.lastKnownInstruction));
				var currValue = this.value();
				if ( (newValue !== currValue) 
					|| lastHadCredentials !==  secHelper.hasTokenCredentials() ) {
					log.log('Control {0} for {1} value is currently {2}', controlId, 
						nodeUrlHelper.nodeId,
						(newValue !== undefined ? newValue : 'N/A'));
					lastKnownStatus = controlStatus;
					if ( lastKnownStatus && !pendingInstruction ) {
						lastKnownStatus.val = newValue; // force this, because instruction value might be newer than status value
					}
					lastKnownInstruction = (execInstruction ? execInstruction : pendingInstruction);
					lastHadCredentials = secHelper.hasTokenCredentials();
					
					// invoke the client callback so they know the data has been updated
					notifyDelegate();
				}
			}
			
			// if timer was defined, keep going as if interval set
			if ( timer !== undefined ) {
				timer = setTimeout(update, currentRefreshMs());
			}
		});

		return self;
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
