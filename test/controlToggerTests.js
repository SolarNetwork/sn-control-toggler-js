import {test,todo} from 'ava';
import sinon from 'sinon';
import {
    Logger as log,
    logLevels,
    NodeInstructionUrlHelper,
} from 'solarnetwork-api-core';

import TestAuthBuilder from './_testAuthBuilder';
import reqMock from './_d3requestMock';

import ControlTogger from '../src/controlToggler';

log.level = logLevels.DEBUG;

const TEST_CONTROL_ID = 'test-control';
const TEST_TOKEN_ID = 'test-token';
const TEST_TOKEN_SECRET = 'secret';
const TEST_NODE_ID = 123;

const TEST_DATE_STR = 'Tue, 25 Apr 2017 14:30:00 GMT';
const TEST_DATE = new Date(TEST_DATE_STR);

test.beforeEach(t => {
    const xhr = sinon.useFakeXMLHttpRequest();
    ControlTogger.__Rewire__('xhrRequest', reqMock(xhr));
    t.context.xhr = xhr;

    const requests = [];
    t.context.requests = requests;
    xhr.onCreate = (req) => requests.push(req);

    const urlHelper = new NodeInstructionUrlHelper({
        host: 'localhost'
    });
    urlHelper.nodeId = TEST_NODE_ID;
    t.context.urlHelper = urlHelper;

    const auth = new TestAuthBuilder(TEST_TOKEN_ID, urlHelper.environment);
    auth.fixedDate = TEST_DATE;
    auth.saveSigningKey(TEST_TOKEN_SECRET);
    t.context.auth = auth;
});

test('construct', t => {
    const toggler = new ControlTogger(t.context.urlHelper, t.context.auth, TEST_CONTROL_ID);
    t.truthy(toggler);
});

test.serial('setValue', t => {
    const toggler = new ControlTogger(t.context.urlHelper, t.context.auth, TEST_CONTROL_ID);

    /** @type {sinon.SinonFakeXMLHttpRequest[]} */
    const reqs = t.context.requests;

    toggler.value(1);

    t.is(reqs.length, 1);

    const queueReq = reqs[0];
    t.is(queueReq.url, "https://localhost/solaruser/api/v1/sec/instr/add");
    t.is(queueReq.requestBody, 'nodeId=123&topic=SetControlParameter&parameters%5B0%5D.name=test-control&parameters%5B0%5D.value=1');
    t.deepEqual(queueReq.requestHeaders, {
        'Accept':'application/json',
        'X-SN-Date':TEST_DATE_STR,
        'Authorization':'SNWS2 Credential=test-token,SignedHeaders=content-type;host;x-sn-date,Signature=0e3806a471d5367b7e2ab914a85dbc3d1229c8eb37c4e41fbe10f2ec02902792',
    });
    queueReq.respond(200, { "Content-Type": "application/json" }, 
        '{"success":true,"data":' 
        +'{"totalResults": 1, "startingOffset": 0, "returnedResultCount": 1, "results": ['
            +'{"created": "2017-07-26 05:57:49.608Z","nodeId":123,"sourceId":"test-control","val":1}'
        +']}}');
});

test.serial('setValue:alreadyPending', t => {
    const toggler = new ControlTogger(t.context.urlHelper, t.context.auth, TEST_CONTROL_ID);

    // force a pending Queued instruction
    toggler.lastKnownInstruction = {
        id: 12345,
        created: '2017-07-26 05:57:49.608Z',
        state: 'Queued',
        parameters: [
            {name: 'SetControlParameter', value: '1'}
        ]
    };

    /** @type {sinon.SinonFakeXMLHttpRequest[]} */
    const reqs = t.context.requests;

    toggler.value(1);

    t.is(reqs.length, 0, 'no requests needed because instruction already pending');
});

test.serial('setValue:differentPending', t => {
    const toggler = new ControlTogger(t.context.urlHelper, t.context.auth, TEST_CONTROL_ID);

    // force a pending Queued instruction
    toggler.lastKnownInstruction = {
        id: 12345,
        created: '2017-07-26 05:57:49.608Z',
        state: 'Queued',
        parameters: [
            {name: 'SetControlParameter', value: '0'}
        ]
    };

    /** @type {sinon.SinonFakeXMLHttpRequest[]} */
    const reqs = t.context.requests;

    toggler.value(1);

    t.is(reqs.length, 2, 'need to issue cancel request, followed by enqueue');

    const cancelReq = reqs[0];
    t.is(cancelReq.url, 'https://localhost/solaruser/api/v1/sec/instr/updateState');
    t.is(cancelReq.requestBody, 'id=12345&state=Declined');
    t.deepEqual(cancelReq.requestHeaders, {
        'Accept':'application/json',
        'X-SN-Date':TEST_DATE_STR,
        'Authorization':'SNWS2 Credential=test-token,SignedHeaders=content-type;host;x-sn-date,Signature=64f5b222d6ed4d80f2c2d9b92a81915e871cc39377b3ba8ddeca88c2a902c10b',
    });
    cancelReq.respond(200, { "Content-Type": "application/json" }, 
        '{"success":true}');

    t.is(toggler.lastKnownInstruction, undefined, 'the last instruction has been cancelled');

    const queueReq = reqs[1];
    t.is(queueReq.url, "https://localhost/solaruser/api/v1/sec/instr/add");
    t.is(queueReq.requestBody, 'nodeId=123&topic=SetControlParameter&parameters%5B0%5D.name=test-control&parameters%5B0%5D.value=1');
    t.deepEqual(queueReq.requestHeaders, {
        'Accept':'application/json',
        'X-SN-Date':TEST_DATE_STR,
        'Authorization':'SNWS2 Credential=test-token,SignedHeaders=content-type;host;x-sn-date,Signature=0e3806a471d5367b7e2ab914a85dbc3d1229c8eb37c4e41fbe10f2ec02902792',
    });
    queueReq.respond(200, { "Content-Type": "application/json" }, 
        '{"success":true,"data":' 
        +'{"totalResults": 1, "startingOffset": 0, "returnedResultCount": 1, "results": ['
            +'{"created": "2017-07-26 05:57:49.608Z","nodeId":123,"sourceId":"test-control","val":1}'
        +']}}');
});
