import {test,todo} from 'ava';
import sinon from 'sinon';
import {
    AuthorizationV2Builder,
    NodeInstructionUrlHelper, 
} from 'solarnetwork-api-core';

import ControlTogger from '../src/controlToggler';

const TEST_CONTROL_ID = 'test-control';
const TEST_TOKEN_ID = 'test-token';
const TEST_NODE_ID = 123;

const xhr = sinon.useFakeXMLHttpRequest();

/** @type {sinon.SinonFakeXMLHttpRequest} */
global.XMLHttpRequest = xhr;

test.beforeEach(t => {
    const requests = [];
    t.requests = requests;
    xhr.onCreate = (req) => requests.push(req);
});

test.afterEach(() => {
    xhr.restore();
});

test.serial('construct', t => {
    const urlHelper = new NodeInstructionUrlHelper({
        host: 'localhost'
    });
    urlHelper.nodeId = TEST_NODE_ID;
    const auth = new AuthorizationV2Builder(TEST_TOKEN_ID, urlHelper.environment);
    const toggler = new ControlTogger(urlHelper, auth, TEST_CONTROL_ID);
    t.truthy(toggler);
});

todo('Tests!');

