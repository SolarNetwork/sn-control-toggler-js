import {test,todo} from 'ava';
import sinon from 'sinon';
import {
    AuthorizationV2Builder,
    Logger as log,
    logLevels,
    NodeInstructionUrlHelper,
} from 'solarnetwork-api-core';

import ControlTogger from '../src/controlToggler';

log.level = logLevels.DEBUG;

const TEST_CONTROL_ID = 'test-control';
const TEST_TOKEN_ID = 'test-token';
const TEST_TOKEN_SECRET = 'secret';
const TEST_NODE_ID = 123;

const XMLHttpRequest = sinon.useFakeXMLHttpRequest();

/** @type {sinon.SinonFakeXMLHttpRequest} */
global.XMLHttpRequest = XMLHttpRequest;

test.before(() => {
    const CT = ControlTogger;
    CT.__Rewire__('jsonRequest', function(url) {
        const xhr = new XMLHttpRequest();
        const headers = new Map();
        const events = new Map();
        const self = {};

        "onload" in xhr
            ? xhr.onload = xhr.onerror = xhr.ontimeout = respond
            : xhr.onreadystatechange = function(o) { xhr.readyState > 3 && respond(o); };


        function callEvent(name, arg) {
            const fns = events.get(name);
            if ( fns ) {
                fns.forEach((fn) => {
                    fn.call(self, arg);
                });
            }
        }
        
        function hasResponse(xhr) {
            var type = xhr.responseType;
            return type && type !== "text"
                ? xhr.response // null on error
                : xhr.responseText; // "" on error
        }
        
        function respond(o) {
            var status = xhr.status, result;
            if (!status && hasResponse(xhr)
                || status >= 200 && status < 300
                || status === 304) {
                result = xhr;
                callEvent("load", result);
            } else {
                callEvent("error", o);
            }
        }

        self.on = (name, cb) => {
            let handlers = events.get(name);
            if ( !handlers ) {
                handlers = [];
                events.set(name, handlers);
            }
            handlers.push(cb);
            return self;
        };
        
        self.mimeType = (type) => {
            headers.set('Accept', type);
            return self;
        };
        
        self.send = (method, data, cb) => {
            xhr.open(method, url);
            headers.forEach((k, v) => {
                xhr.setRequestHeader(k, v);
            });
            if ( cb ) {
                self.on("error", cb).on("load", (xhr) => cb(null, xhr));
            }
            callEvent('beforesend', xhr);
            xhr.send(data);
            return self;
        };

        return self;
    });
});

test.beforeEach(t => {
    const requests = [];
    t.context.requests = requests;
    XMLHttpRequest.onCreate = (req) => requests.push(req);

    const urlHelper = new NodeInstructionUrlHelper({
        host: 'localhost'
    });
    urlHelper.nodeId = TEST_NODE_ID;
    t.context.urlHelper = urlHelper;

    const auth = new AuthorizationV2Builder(TEST_TOKEN_ID, urlHelper.environment);
    auth.saveSigningKey(TEST_TOKEN_SECRET);
    t.context.auth = auth;
});

test.afterEach(() => {
    XMLHttpRequest.restore();
});

test.serial('construct', t => {
    const toggler = new ControlTogger(t.context.urlHelper, t.context.auth, TEST_CONTROL_ID);
    t.truthy(toggler);
});

test.serial('setValue', t => {
    log.debug('Hi there!');
    const toggler = new ControlTogger(t.context.urlHelper, t.context.auth, TEST_CONTROL_ID);

    /** @type {sinon.SinonFakeXMLHttpRequest[]} */
    const reqs = t.context.requests;

    toggler.value(1);

    t.is(reqs.length, 1);

    const queueReq = reqs[0];
    t.is(queueReq.url, "https://localhost/solaruser/api/v1/sec/instr/add");
    t.is(queueReq.requestBody, 'nodeId=123&topic=SetControlParameter&parameters%5B0%5D.name=test-control&parameters%5B0%5D.value=1');
    t.deepEqual(queueReq.requestHeaders, {
        'Accept':'application/json'
    });
    queueReq.respond(200, { "Content-Type": "application/json" }, 
        '{"success":true,"data":' 
        +'{"totalResults": 1, "startingOffset": 0, "returnedResultCount": 1, "results": ['
            +'{"created": "2017-07-26 05:57:49.608Z","nodeId":123,"sourceId":"test-control","val":1}'
        +']}}');

    t.is(toggler.value(), 1);
});


todo('Tests!');

