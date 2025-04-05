# SolarNetwork Control Toggler

> :warning: This project has been absorbed into the [solarnetwork-api-core][solarnetwork-api-core]
> package, starting in its `3.1.0` release. The classes are in the [Tool sub-package][tool-module].

# Legacy information

Control Toggler is a helper class that uses the SolarNetwork [Instruction API][api-queue-instr] to
request a SolarNode to set the value of a _control_ to `1` (on) or `0` (off), and the
SolarNetwork [Datum Query API][api-datum-recent] to track the value of the control.

The Instruction API is asynchronous and changing a control value requires the following steps:

-   Enqueue instruction to set control value
-   Wait for SolarNode to receive, execute, and update instruction status to `Completed` (or `Rejected`)
-   Wait for SolarNode to post updated control value datum for confirmation

Control Toggler handles these steps through a simple API for setting the desired value and using
a callback function to get notified when the value changes.

Some example SolarNode plugins that support on/off switching are:

-   [Mock Control](https://github.com/SolarNetwork/solarnetwork-node/tree/master/net.solarnetwork.node.control.mock) (good for testing)
-   [LATA switch](https://github.com/SolarNetwork/solarnetwork-node/tree/master/net.solarnetwork.node.control.jf2.lata)
-   [Modbus switch](https://github.com/SolarNetwork/solarnetwork-node/tree/master/net.solarnetwork.node.control.modbus.toggle)

# Use

To include the library in your NPM-based project, run the following:

```sh
npm i solarnetwork-control-toggler
```

# API docs

The latest API documentation is published [here](https://solarnetwork.github.io/sn-control-toggler-js/), or
you can build the API documentation by running the `apidoc` script:

```sh
npm run apidoc
```

That will produce HTML documentation in `docs/html`.

[api-queue-instr]: https://github.com/SolarNetwork/solarnetwork/wiki/SolarUser-API#queue-instruction
[api-datum-recent]: https://github.com/SolarNetwork/solarnetwork/wiki/SolarQuery-API#most-recent-datum
[solarnetwork-api-core]: https://www.npmjs.com/package/solarnetwork-api-core
[tool-module]: https://solarnetwork.github.io/sn-api-core-js/html/modules/Tool.html
