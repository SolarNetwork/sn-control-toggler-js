// https://github.com/SolarNetwork/sn-control-toggler-js Version 3.0.1. Copyright 2025 SolarNetwork Foundation.
import { InstructionStates, Datum, CommonInstructionTopicName, Instruction, DatumFilter } from 'solarnetwork-api-core/lib/domain';
import { Logger } from 'solarnetwork-api-core/lib/util';
import { SolarQueryApi, AuthorizationV2Builder, HttpMethod, HttpContentType, HttpHeaders } from 'solarnetwork-api-core/lib/net';

// The Fetch API subset required by DatumLoader
var fetch$1 = fetch;

/**
 * Instruction states that indicate a toggle instruction is in-flight.
 * @private
 */
const InstructionActiveStates = new Set([
    InstructionStates.Queuing,
    InstructionStates.Queued,
    InstructionStates.Received,
    InstructionStates.Executing,
]);
/**
 * Instruction states that indicate a toggle instruction is comleted or declined.
 * @private
 */
const InstructionFinishedStates = new Set([
    InstructionStates.Completed,
    InstructionStates.Declined,
]);
/**
 * Extension to Datum class with a specific `val` property.
 */
class ControlDatum extends Datum {
    /** The control value. */
    val;
    constructor(info) {
        super(info);
        this.val = info.val;
    }
}
/**
 * Manage the state of a boolean control switch using SolarNetwork `SetControlParameter` instructions.
 *
 * Use an instance of this class to keep track of, and update the state of, a single switch-like
 * control configured on a SolarNode. Because updating the state of a control is an asynchronous
 * process involving multiple steps, this class simplifies this with a promise-based API that
 * will be resolved when the control value changes.
 *
 * If the {@link ControlToggler#start} method is called, the toggler will make periodic
 * calls to SolarNetwork to get the most recent value for the configured control ID, which it
 * treats as a {@link ControlDatum} `sourceId` value. Thus if some other process changes the
 * control, the toggler will eventually pick up that change and invoke the callback function.
 *
 * @example
 * const auth = new AuthorizationV2Builder('token');
 * auth.saveSigningKey('secret');
 *
 * const toggler = new ControlTogger(new SolarUserApi(), auth, 123, '/power/switch/1');
 * toggler.callback = (error) => {
 *   // invoked when instruction states change, or the control value changes
 *   console.log(`Control ${toggler.controlId} value == ${toggler.value()}; pending == ${toggler.hasPendingStateChange}`);
 * };
 *
 * // enable automatic keeping track of state and the callback hook
 * toggler.start();
 *
 * // ... at some point later, maybe in response to a UI event, update the state;
 * // the callback will be invoked then the value changes
 * toggler.value(1);
 */
class ControlToggler {
    #api;
    #auth;
    #queryApi;
    #queryAuth;
    /**
     * The node ID to manage the control on.
     */
    nodeId;
    /**
     * The control ID to manage.
     */
    controlId;
    /** A timeout identifier. */
    #timer;
    /**
     * The last known instruction status. The `val` property indicates the control value.
     */
    #lastKnownDatum;
    /**
     * The last known instruction object.
     */
    #lastKnownInstruction;
    /**
     * The refresh rate, in milliseconds.
     * Defaults to 20 seconds.
     */
    refreshMs = 20000;
    /**
     * The refresh rate, in milliseconds, when a toggle instruction is queued.
     * Defaults to 5 seconds.
     */
    pendingRefreshMs = 5000;
    /**
     * A callback function, which is called after the state of the control changes.
     * The `this` reference will be set to this object. If an error has occurred,
     * the error will be passed as the first argument.
     */
    callback;
    /**
     * Constructor.
     * @param api the URL helper to use
     * @param auth the auth builder to authenticate requests with; the required credentials
     *                    must be set appropriately
     * @param nodeId the ID of the node with the control to manage
     * @param controlId the ID of the control to manage
     * @param queryApi a URL helper for accessing node datum via SolarQuery; if not provided one
     *                 will be created using the environment from `api`. Useful in a development
     *                 environment when the SolarUser and SolarQuery hosts are different.
     */
    constructor(api, auth, nodeId, controlId, queryApi) {
        this.#api = api;
        this.#auth = auth;
        this.nodeId = nodeId;
        this.controlId = controlId;
        this.#queryApi = queryApi || new SolarQueryApi(api.environment);
        this.#queryAuth = queryApi
            ? new AuthorizationV2Builder(auth.tokenId, queryApi.environment).key(auth.key())
            : auth;
    }
    #notifyDelegate(error) {
        const callback = this.callback;
        if (callback !== undefined) {
            try {
                callback.call(this, error);
            }
            catch (callbackError) {
                Logger.error("Error in callback: %s", callbackError);
            }
        }
    }
    /**
     * Find an active `SetControlParameter` Instruction for the configured `controlId`.
     *
     * @param data array of instructions
     * @returns the active instruction, or `undefined`
     * @private
     */
    #getActiveInstruction(data) {
        if (!Array.isArray(data) || data.length === 0) {
            return undefined;
        }
        const controlId = this.controlId;
        const instruction = data.reduce((prev, curr) => {
            if (curr.topic ===
                CommonInstructionTopicName.SetControlParameter &&
                Array.isArray(curr.parameters) &&
                curr.parameters.length > 0 &&
                curr.parameters[0].name === controlId &&
                (prev === undefined || prev.created < curr.created)) {
                return curr;
            }
            return prev;
        }, undefined);
        if (instruction !== undefined) {
            Logger.debug("Active instruction %d for node %d found in state %s (set control %s to %s)", instruction.id, this.nodeId, instruction.state, controlId, instruction.parameters !== undefined
                ? instruction.parameters[0].value
                : null);
            return new Instruction(instruction);
        }
        return undefined;
    }
    /**
     * Get the last known instruction value, e.g. the state of the control.
     * @returns the last know value of the control (0 or 1), or `undefined`
     * @private
     */
    #lastKnownInstructionValue() {
        return Array.isArray(this.#lastKnownInstruction?.parameters)
            ? this.#lastKnownInstruction.parameters[0].value
            : undefined;
    }
    /**
     * Calculate the refresh rate to use.
     * @returns the refresh rate to use, in milliseconds
     * @private
     */
    #currentRefreshMs() {
        return this.hasPendingStateChange
            ? this.pendingRefreshMs
            : this.refreshMs;
    }
    /**
     * Test if a state change is pending confirmation.
     *
     * @returns `true` if a state change is pending (not complete)
     */
    get hasPendingStateChange() {
        const state = this.#lastKnownInstruction?.instructionState;
        return state !== undefined && InstructionActiveStates.has(state);
    }
    /**
     * Return the value from either the `controlStatus` or the first parameter value of an `instruction`,
     * whichever is valid and more recent.
     *
     * @param controlDatum a control status object
     * @param instruction  an instruction object
     * @returns the control status value, or `undefined` if not known
     * @private
     */
    #mostRecentValue(controlDatum, instruction) {
        if (!instruction ||
            InstructionStates.Declined.equals(instruction.state)) {
            return controlDatum?.val;
        }
        else if (!controlDatum) {
            return Array.isArray(instruction.parameters)
                ? instruction.parameters[0].value
                : undefined;
        }
        // return the newer value
        const statusDate = controlDatum.date;
        const instructionDate = instruction.date;
        if (!(statusDate && instructionDate)) {
            return undefined;
        }
        return statusDate > instructionDate
            ? controlDatum.val
            : Array.isArray(instruction.parameters)
                ? instruction.parameters[0].value
                : undefined;
    }
    /**
     * Fetch a URL.
     *
     * @template T the expected result type
     * @param method the HTTP method to use
     * @param url the URL to request
     * @returns promise of the results
     * @private
     */
    #fetch(method, url, auth) {
        let fetchUrl = url;
        let reqData = null;
        let contentType = undefined;
        if (method !== HttpMethod.GET) {
            const queryIndex = url.indexOf("?");
            if (queryIndex) {
                reqData = url.substring(queryIndex + 1);
                contentType = HttpContentType.FORM_URLENCODED_UTF8;
                fetchUrl = url.substring(0, queryIndex);
            }
        }
        const headers = {
            Accept: "application/json",
        };
        if (auth.signingKeyValid) {
            auth.reset().snDate(true).method(method).url(url);
            if (contentType) {
                auth.contentType(contentType);
                headers[HttpHeaders.CONTENT_TYPE] = contentType;
            }
            headers[HttpHeaders.AUTHORIZATION] = auth.buildWithSavedKey();
            headers[HttpHeaders.X_SN_DATE] = auth.requestDateHeaderValue;
        }
        return fetch$1(fetchUrl, {
            method: method,
            headers: headers,
            body: reqData,
        }).then((res) => {
            return res.json().then((json) => {
                const r = json;
                if (!r.success) {
                    let msg = r.message;
                    if (!msg) {
                        msg = `HTTP ${res.status}`;
                    }
                    if (r.code) {
                        msg += " (" + r.code + ")";
                    }
                    throw new Error(msg);
                }
                return r.data;
            }, (error) => {
                const msg = res.ok
                    ? error
                    : `HTTP ${res.status}` +
                        (res.statusText ? ": " + res.statusText : "");
                throw new Error(msg);
            });
        });
    }
    value(desiredValue) {
        if (desiredValue === undefined) {
            return this.#lastKnownDatum?.val;
        }
        if (!this.#auth.signingKeyValid) {
            return Promise.reject(new Error("Valid credentials not configured"));
        }
        const currentValue = this.#lastKnownDatum?.val;
        let pendingState = this.#lastKnownInstruction?.instructionState;
        let pendingValue = this.#lastKnownInstructionValue();
        let cancel;
        let enqueue;
        /* !!!!!
           Note the loose `!= desiredValue` equality checks for type flexibility
           !!!!! */
        if (pendingState === InstructionStates.Queued &&
            pendingValue != desiredValue &&
            this.#lastKnownInstruction) {
            // cancel the pending instruction
            Logger.debug("Canceling node %d pending control %s to %s request %d", this.nodeId, this.controlId, pendingValue, this.#lastKnownInstruction.id);
            const cancelInstructionUrl = this.#api.updateInstructionStateUrl(this.#lastKnownInstruction.id, InstructionStates.Declined);
            cancel = this.#fetch(HttpMethod.POST, cancelInstructionUrl, this.#auth);
            this.#lastKnownInstruction = undefined;
            pendingState = undefined;
            pendingValue = undefined;
        }
        if (currentValue != desiredValue && pendingValue != desiredValue) {
            Logger.debug("Request node %d to change control %s to %d", this.nodeId, this.controlId, desiredValue);
            const queueInstructionUrl = this.#api.queueInstructionUrl(CommonInstructionTopicName.SetControlParameter, [{ name: this.controlId, value: String(desiredValue) }], this.nodeId);
            if (cancel) {
                enqueue = cancel.then(() => {
                    this.#lastKnownInstruction = undefined;
                    return this.#fetch(HttpMethod.POST, queueInstructionUrl, this.#auth);
                });
            }
            else {
                enqueue = this.#fetch(HttpMethod.POST, queueInstructionUrl, this.#auth);
            }
            enqueue
                .then((instr) => {
                this.#lastKnownInstruction = new Instruction(instr);
                this.#notifyDelegate();
                if (this.#timer) {
                    this.stop();
                    this.start(this.#currentRefreshMs());
                }
            })
                .catch((error) => {
                Logger.error("Error updating node %d control toggler %s: %s", this.nodeId, this.controlId, error.status);
                this.#notifyDelegate(error);
            });
        }
        else {
            enqueue = Promise.resolve(this.#lastKnownInstruction);
        }
        return enqueue;
    }
    /**
     * Refresh the control state from SolarNetwork.
     *
     * Once the {@link ControlToggler#start} method is called, this method is invoked periodically
     * automatically. Only call this directly if you need to manually update the state of the control.
     *
     * @returns promise that resolves after getting the updated state
     */
    update() {
        if (!this.#auth.signingKeyValid) {
            return Promise.reject(new Error("Valid credentials not configured"));
        }
        const reqs = [];
        // query for most recently available datum for control to check control value
        const filter = new DatumFilter();
        filter.nodeId = this.nodeId;
        filter.sourceId = this.controlId;
        const mostRecentUrl = this.#queryApi.mostRecentDatumUrl(filter);
        reqs[0] = this.#fetch(HttpMethod.GET, mostRecentUrl, this.#queryAuth);
        // query for pending instructions to see if we have an in-flight SetControlParameter on the go already
        const viewPendingUrl = this.#api.viewPendingInstructionsUrl(this.nodeId);
        reqs[1] = this.#fetch(HttpMethod.GET, viewPendingUrl, this.#auth);
        const lastKnownInstr = this.#lastKnownInstruction;
        if (lastKnownInstr?.instructionState &&
            !InstructionFinishedStates.has(lastKnownInstr.instructionState)) {
            // also refresh this specific instruction, to know when it goes to Completed so we can
            // assume the control value has changed, even if the mostRecent data lags behind
            const viewInstructionUrl = this.#api.viewInstructionUrl(lastKnownInstr.id);
            reqs[2] = this.#fetch(HttpMethod.GET, viewInstructionUrl, this.#auth);
        }
        return Promise.all(reqs)
            .then((results) => {
            const mostRecentList = results[0].results;
            const pendingInstruction = this.#getActiveInstruction(results[1]);
            const execInstruction = results.length > 2 && results[2]
                ? new Instruction(results[2])
                : undefined;
            const mostRecentDatumInfo = Array.isArray(mostRecentList)
                ? mostRecentList.find((e) => e.sourceId === this.controlId)
                : undefined;
            const mostRecentDatum = mostRecentDatumInfo
                ? new ControlDatum(mostRecentDatumInfo)
                : undefined;
            const newValue = this.#mostRecentValue(mostRecentDatum, execInstruction
                ? execInstruction
                : pendingInstruction
                    ? pendingInstruction
                    : this.#lastKnownInstruction);
            const currValue = this.value();
            if (newValue !== currValue || execInstruction) {
                Logger.debug("Current node %d control %s value is %s", this.nodeId, this.controlId, newValue !== undefined ? newValue : "N/A");
                this.#lastKnownDatum = mostRecentDatum;
                if (mostRecentDatum && !pendingInstruction && newValue) {
                    mostRecentDatum.val = newValue; // force this, because instruction value might be newer than status value
                }
                this.#lastKnownInstruction = execInstruction
                    ? execInstruction
                    : pendingInstruction;
                // invoke the client callback so they know the data has been updated
                this.#notifyDelegate();
            }
            // if timer was defined, keep going as if interval set
            if (this.#timer !== undefined) {
                this.#timer = setTimeout(() => {
                    this.update();
                }, this.#currentRefreshMs());
            }
            return this.value();
        })
            .catch((error) => {
            Logger.error("Error querying node %d control toggler %s status: %s", this.nodeId, this.controlId, error.status);
            this.#notifyDelegate(error);
        });
    }
    /**
     * Start automatically updating the status of the configured control.
     *
     * @param when an optional offset in milliseconds to start at (defaults to 20)
     * @returns this object
     */
    start(when) {
        const timer = this.#timer;
        if (!timer) {
            this.#timer = setTimeout(() => {
                this.update();
            }, when || 20);
        }
        return this;
    }
    /**
     * Stop automatically updating the status of the configured control.
     *
     * @returns this object
     */
    stop() {
        const timer = this.#timer;
        if (timer) {
            clearTimeout(timer);
            this.#timer = null;
        }
        return this;
    }
}

export { ControlDatum, ControlToggler };
//# sourceMappingURL=solarnetwork-control-toggler.es.js.map
