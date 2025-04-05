import { Datum, DatumInfo, InstructionInfo } from "solarnetwork-api-core/lib/domain";
import { AuthorizationV2Builder, SolarQueryApi, SolarUserApi } from "solarnetwork-api-core/lib/net";
/** The control value type. */
export type ControlValueType = boolean | number | string;
/**
 * Extension to Datum class with a specific `val` property.
 */
export declare class ControlDatum extends Datum {
    /** The control value. */
    val?: ControlValueType;
    constructor(info: DatumInfo);
}
/**
 * The data callback function.
 */
export type ControlCallbackFn = (
/** The control togger invoking the callback. */
this: ControlToggler, 
/** An error if a failure occurred. */
error?: Error) => void;
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
declare class ControlToggler {
    #private;
    /**
     * The node ID to manage the control on.
     */
    readonly nodeId: number;
    /**
     * The control ID to manage.
     */
    readonly controlId: string;
    /**
     * The refresh rate, in milliseconds.
     * Defaults to 20 seconds.
     */
    refreshMs: number;
    /**
     * The refresh rate, in milliseconds, when a toggle instruction is queued.
     * Defaults to 5 seconds.
     */
    pendingRefreshMs: number;
    /**
     * A callback function, which is called after the state of the control changes.
     * The `this` reference will be set to this object. If an error has occurred,
     * the error will be passed as the first argument.
     */
    callback?: ControlCallbackFn;
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
    constructor(api: SolarUserApi, auth: AuthorizationV2Builder, nodeId: number, controlId: string, queryApi?: SolarQueryApi);
    /**
     * Test if a state change is pending confirmation.
     *
     * @returns `true` if a state change is pending (not complete)
     */
    get hasPendingStateChange(): boolean;
    /**
     * Get the desired control value.
     *
     * @returns the last known control value
     */
    value(): ControlValueType | undefined;
    /**
     * Set the desired control value.
     *
     * @param desiredValue the control value to set
     * @returns a promise that resolves to the enqueued instruction
     */
    value(desiredValue: ControlValueType): Promise<InstructionInfo>;
    /**
     * Refresh the control state from SolarNetwork.
     *
     * Once the {@link ControlToggler#start} method is called, this method is invoked periodically
     * automatically. Only call this directly if you need to manually update the state of the control.
     *
     * @returns promise that resolves after getting the updated state
     */
    update(): Promise<ControlValueType | undefined | void>;
    /**
     * Start automatically updating the status of the configured control.
     *
     * @param when an optional offset in milliseconds to start at (defaults to 20)
     * @returns this object
     */
    start(when?: number): this;
    /**
     * Stop automatically updating the status of the configured control.
     *
     * @returns this object
     */
    stop(): this;
}
export default ControlToggler;
//# sourceMappingURL=controlToggler.d.ts.map