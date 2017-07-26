import {test,todo} from 'ava';
import sinon from 'sinon';
import {
    AuthorizationV2Builder,
    Logger as log,
    logLevels,
    NodeInstructionUrlHelper,
} from 'solarnetwork-api-core';

import reqMock from './_d3requestMock';

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
    ControlTogger.__Rewire__('xhrRequest', reqMock(XMLHttpRequest));
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

