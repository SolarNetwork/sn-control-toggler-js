// https://github.com/SolarNetwork/sn-control-toggler-js Version 0.2.1. Copyright 2019 SolarNetwork Foundation.
import { request } from 'd3-request';
import { queue } from 'd3-queue';
import { InstructionStates, AuthorizationV2Builder, NodeDatumUrlHelper, Logger, InstructionState, dateParser, HttpHeaders, HttpMethod, HttpContentType } from 'solarnetwork-api-core';

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

function _defineProperties(target, props) {
  for (var i = 0; i < props.length; i++) {
    var descriptor = props[i];
    descriptor.enumerable = descriptor.enumerable || false;
    descriptor.configurable = true;
    if ("value" in descriptor) descriptor.writable = true;
    Object.defineProperty(target, descriptor.key, descriptor);
  }
}

function _createClass(Constructor, protoProps, staticProps) {
  if (protoProps) _defineProperties(Constructor.prototype, protoProps);
  if (staticProps) _defineProperties(Constructor, staticProps);
  return Constructor;
}

var SetControlParameterInstructionName = "SetControlParameter";
/**
 * Instruction states that indicate a toggle instruction is in-flight.
 * @type {Set}
 * @private
 */

var InstructionActiveStates = new Set([InstructionStates.Queued, InstructionStates.Received, InstructionStates.Executing]);
/**
 * Instruction states that indicate a toggle instruction is comleted or declined.
 * @type {Set}
 * @private
 */

var InstructionFinishedStates = new Set([InstructionStates.Completed, InstructionStates.Declined]);
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
 * The status callback function.
 *
 * This function will be invoked whenever the control value has changed. Additionally, it will be
 * invoked periodically while a state change has not been completed, even if the control value
 * has not changed. Use {@link ControlToggler#value} to get the current control value and
 * {@link ControlToggler#hasPendingStateChange} to test if that value is still pending.
 *
 * @callback ControlToggler~statusCallback
 * @this ControlToggler
 * @param {Error} [error] an error if a failure occurred
 */

/**
 * Manage the state of a boolean control switch using SolarNetwork `SetControlParameter` instructions.
 *
 * Use an instance of this class to keep track of, and update the state of, a single switch-like
 * control configured on a SolarNode. Because updating the state of a control is an asynchronous
 * process involving multiple steps, this class simplifies this with a simple callback API that
 * will be invoked whenever the control value changes.
 *
 * Once the {@link ControlToggler#start} method has been called, the toggler will make periodic
 * calls to SolarNetwork to get the most recent value for the configured control ID, which it
 * treats as a {@link ControlDatum} `sourceId` value. Thus if some other process changes the
 * control, the toggler will eventually pick up that change and invoke the callback function.
 *
 * @example
 * const urlHelper = new NodeInstructionUrlHelper();
 * urlHelper.nodeId = 123;
 *
 * const auth = new TestAuthBuilder('token');
 * auth.saveSigningKey('secret');
 *
 * const toggler = new ControlTogger(urlHelper, auth, '/power/switch/1');
 * toggler.callback = function(error) {
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

var ControlToggler =
/*#__PURE__*/
function () {
  /**
   * Constructor.
   * @param {NodeInstructionUrlHelper} urlHelper the URL helper to use, which must support node instructions with the `NodeInstructionUrlHelperMixin`
   *                    and be configured with the `nodeId` property for the node to be managed
   * @param {AuthorizationV2Builder} authBuilder the auth builder to authenticate requests with; the required credentials
   *                                             must be set appropriately
   * @param {string} controlId the ID of the control to manage
   * @param {NodeDatumUrlHelper} [queryUrlHelper] a URL helper for accessing node datum via SolarQuery; if not provided one
   *                                              will be created using the `environment` from `urlHelper`
   */
  function ControlToggler(urlHelper, authBuilder, controlId, queryUrlHelper) {
    _classCallCheck(this, ControlToggler);

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

    this.queryUrlHelper = queryUrlHelper || new NodeDatumUrlHelper(urlHelper.environment); // force the nodeId / sourceId to our controlId

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

  _createClass(ControlToggler, [{
    key: "notifyDelegate",
    value: function notifyDelegate(error) {
      var callback = this.callback;

      if (callback !== undefined) {
        try {
          callback.call(self, error);
        } catch (callbackError) {
          Logger.error("Error in callback: %s", callbackError);
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

  }, {
    key: "getActiveInstruction",
    value: function getActiveInstruction(data) {
      if (!Array.isArray(data) || data.length === 0) {
        return undefined;
      }

      var controlId = this.controlId;
      var instruction = data.reduce(function (prev, curr) {
        if (curr.topic === SetControlParameterInstructionName && Array.isArray(curr.parameters) && curr.parameters.length > 0 && curr.parameters[0].name === controlId && (prev === undefined || prev.created < curr.created)) {
          return curr;
        }

        return prev;
      }, undefined);

      if (instruction !== undefined) {
        Logger.debug("Active instruction for %d found in state %s (set control %s to %s)", this.instructionUrlHelper.nodeId, instruction.state, controlId, instruction.parameters[0].value);
      }

      return instruction;
    }
    /**
     * Get the last know instruction state, if available.
     * @returns {InstructionState} the last known instruction state, or `undefined`
     * @private
     */

  }, {
    key: "lastKnownInstructionState",
    value: function lastKnownInstructionState() {
      var lastKnownInstruction = this.lastKnownInstruction;
      return lastKnownInstruction === undefined ? undefined : InstructionState.valueOf(lastKnownInstruction.state);
    }
    /**
     * Get the last known instruction value, e.g. the state of the control.
     * @returns {number} the last know value of the control (0 or 1), or `undefined`
     * @private
     */

  }, {
    key: "lastKnownInstructionValue",
    value: function lastKnownInstructionValue() {
      var lastKnownInstruction = this.lastKnownInstruction;
      return lastKnownInstruction === undefined ? undefined : Number(lastKnownInstruction.parameters[0].value);
    }
    /**
     * Calculate the refresh rate to use.
     * @returns {number} the refresh rate to use, in milliseconds
     * @private
     */

  }, {
    key: "currentRefreshMs",
    value: function currentRefreshMs() {
      return this.hasPendingStateChange ? this.pendingRefreshMs : this.refreshMs;
    }
    /**
     * Test if a state change is pending confirmation.
     *
     * @returns {boolean} `true` if a state change is pending (not complete)
     */

  }, {
    key: "mostRecentValue",

    /**
     * Return the value from either the `controlStatus` or the first parameter value of an `instruction`,
     * whichever is valid and more recent.
     *
     * @param {ControlDatum} controlDatum a control status object
     * @param {Instruction} instruction  an instruction object
     * @returns {number} the control status value
     * @private
     */
    value: function mostRecentValue(controlDatum, instruction) {
      if (!instruction || InstructionStates.Declined.equals(instruction.status)) {
        return controlDatum ? controlDatum.val : undefined;
      } else if (!controlDatum) {
        return Number(instruction.parameters[0].value);
      } // return the newer value


      var statusDate = dateParser(controlDatum.created);
      var instructionDate = dateParser(instruction.created);
      return statusDate.getTime() > instructionDate.getTime() ? controlDatum.val : Number(instruction.parameters[0].value);
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

  }, {
    key: "handleRequestAuth",
    value: function handleRequestAuth(request, method, url, contentType) {
      var now = new Date();
      this.authBuilder.reset().date(now).snDate(true).method(method).url(url);

      if (contentType) {
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

  }, {
    key: "deferJsonRequestWithAuth",
    value: function deferJsonRequestWithAuth(q, method, url) {
      var _this = this;

      var queryIndex = -1;
      var reqData = undefined;
      var contentType = undefined;

      if (method !== HttpMethod.GET) {
        queryIndex = url.indexOf("?");
        reqData = url.substring(queryIndex + 1);
        contentType = HttpContentType.FORM_URLENCODED_UTF8;
      }

      var req = request(queryIndex >= 0 ? url.substring(0, queryIndex) : url).mimeType(HttpContentType.APPLICATION_JSON).on("beforesend", function (request) {
        _this.handleRequestAuth(request, method, url, contentType);
      });

      if (contentType) {
        req.header("Content-Type", contentType);
      }

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

  }, {
    key: "value",
    value: function value(desiredValue) {
      var _this2 = this;

      if (!arguments.length) return this.lastKnownDatum === undefined ? undefined : this.lastKnownDatum.val;

      if (!this.authBuilder.signingKeyValid) {
        throw new Error("Valid credentials not configured");
      }

      var controlId = this.controlId;
      var instrUrlHelper = this.instructionUrlHelper;
      var q = queue();
      var currentValue = this.lastKnownDatum === undefined ? undefined : this.lastKnownDatum.val;
      var pendingState = this.lastKnownInstructionState();
      var pendingValue = this.lastKnownInstructionValue();

      if (pendingState === InstructionStates.Queued && pendingValue !== desiredValue) {
        // cancel the pending instruction
        Logger.debug("Canceling %d pending control %s switch to %s", instrUrlHelper.nodeId, controlId, pendingValue);
        var cancelInstructionUrl = instrUrlHelper.updateInstructionStateUrl(this.lastKnownInstruction.id, InstructionStates.Declined);
        this.deferJsonRequestWithAuth(q, HttpMethod.POST, cancelInstructionUrl);
        this.lastKnownInstruction = undefined;
        pendingState = undefined;
        pendingValue = undefined;
      }

      if (currentValue !== desiredValue && pendingValue !== desiredValue) {
        Logger.debug("Request %d to change control %s to %d", instrUrlHelper.nodeId, controlId, desiredValue);
        var queueInstructionUrl = instrUrlHelper.queueInstructionUrl(SetControlParameterInstructionName, [{
          name: controlId,
          value: String(desiredValue)
        }]);
        this.deferJsonRequestWithAuth(q, HttpMethod.POST, queueInstructionUrl);
      }

      q.awaitAll(function (error, results) {
        if (error) {
          Logger.error("Error updating %d control toggler %s: %s", instrUrlHelper.nodeId, controlId, error.status);

          _this2.notifyDelegate(error);

          return;
        }

        if (results.length < 1) {
          // we queued nothing
          return;
        }

        results.forEach(function (e, i) {
          if (e.responseText) {
            results[i] = JSON.parse(e.responseText);
          }
        });
        var cancelResult = results[0]; // note == null check here, which handles either undefined or null

        if (cancelResult.data == null && cancelResult.success === true) {
          // it was cancelled
          _this2.lastKnownInstruction = undefined;
        }

        var instructionResult = results[results.length - 1].data;

        if (!(instructionResult == null)) {
          // this is the last know instruction now
          _this2.lastKnownInstruction = instructionResult;
        } // invoke the client callback so they know the instruction state has changed


        _this2.notifyDelegate(); // reset timer to start polling at pendingRefreshMs rate


        if (_this2.timer) {
          _this2.stop();

          _this2.start(_this2.currentRefreshMs());
        }
      });
      return this;
    }
    /**
     * Refresh the control state from SolarNetwork.
     *
     * Once the {@link ControlToggler#start} method is called, this method is invoked periodically
     * automatically. Only call this directly if you need to manually update the state of the control.
     *
     * @returns {ControlToggler} this object
     */

  }, {
    key: "update",
    value: function update() {
      var _this3 = this;

      if (!this.authBuilder.signingKeyValid) {
        throw new Error("Valid credentials not configured");
      }

      var controlId = this.controlId;
      var instrUrlHelper = this.instructionUrlHelper;
      var queryUrlHelper = this.queryUrlHelper;
      var q = queue(); // query for most recently available datum for control to check control value

      var mostRecentUrl = queryUrlHelper.mostRecentDatumUrl();
      this.deferJsonRequestWithAuth(q, HttpMethod.GET, mostRecentUrl); // query for pending instructions to see if we have an in-flight SetControlParameter on the go already

      var viewPendingUrl = instrUrlHelper.viewPendingInstructionsUrl();
      this.deferJsonRequestWithAuth(q, HttpMethod.GET, viewPendingUrl);

      if (this.lastKnownInstruction && !InstructionFinishedStates.has(this.lastKnownInstructionState())) {
        // also refresh this specific instruction, to know when it goes to Completed so we can
        // assume the control value has changed, even if the mostRecent data lags behind
        var viewInstructionUrl = instrUrlHelper.viewInstructionUrl(this.lastKnownInstruction.id);
        this.deferJsonRequestWithAuth(q, HttpMethod.GET, viewInstructionUrl);
      }

      q.awaitAll(function (error, results) {
        if (error) {
          Logger.error("Error querying %d control toggler %s status: %s", instrUrlHelper.nodeId, controlId, error.status);

          _this3.notifyDelegate(error);
        } else {
          results.forEach(function (e, i) {
            if (e.responseText) {
              results[i] = JSON.parse(e.responseText);
            }
          });
          var mostRecentDatum, active, executing;

          if (results.length > 0) {
            mostRecentDatum = results[0];
          }

          if (results.length > 1) {
            active = results[1];
          }

          if (results.length > 2) {
            executing = results[2];
          } // get current status of control via most recent datum

          /** @type {ControlDatum} */


          var mostRecentControlDatum = undefined;

          if (mostRecentDatum.data && Array.isArray(mostRecentDatum.data.results)) {
            mostRecentControlDatum = mostRecentDatum.data.results.find(function (e) {
              return e.sourceId === controlId;
            });
          } // get active (pending) instruction (if any)


          var execInstruction = executing ? executing.data : undefined;
          var pendingInstruction = active ? _this3.getActiveInstruction(active.data) : undefined;

          var newValue = _this3.mostRecentValue(mostRecentControlDatum, execInstruction ? execInstruction : pendingInstruction ? pendingInstruction : _this3.lastKnownInstruction);

          var currValue = _this3.value();

          if (newValue !== currValue || execInstruction) {
            Logger.debug("Current %d control %s value is %s", instrUrlHelper.nodeId, controlId, newValue !== undefined ? newValue : "N/A");
            _this3.lastKnownDatum = mostRecentControlDatum;

            if (_this3.lastKnownDatum && !pendingInstruction) {
              _this3.lastKnownDatum.val = newValue; // force this, because instruction value might be newer than status value
            }

            _this3.lastKnownInstruction = execInstruction ? execInstruction : pendingInstruction; // invoke the client callback so they know the data has been updated

            _this3.notifyDelegate();
          }
        } // if timer was defined, keep going as if interval set


        if (_this3.timer !== undefined) {
          _this3.timer = setTimeout(function () {
            _this3.update();
          }, _this3.currentRefreshMs());
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

  }, {
    key: "start",
    value: function start(when) {
      var _this4 = this;

      var timer = this.timer;

      if (!timer) {
        this.timer = setTimeout(function () {
          _this4.update();
        }, when || 20);
      }

      return this;
    }
    /**
     * Stop automatically updating the status of the configured control.
     *
     * @returns {ControlToggler} this object
     */

  }, {
    key: "stop",
    value: function stop() {
      var timer = this.timer;

      if (timer) {
        clearTimeout(timer);
        this.timer = null;
      }

      return this;
    }
  }, {
    key: "hasPendingStateChange",
    get: function get() {
      return InstructionActiveStates.has(this.lastKnownInstructionState());
    }
  }]);

  return ControlToggler;
}();

export { ControlToggler };
//# sourceMappingURL=solarnetwork-control-toggler.es.js.map
