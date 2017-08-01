import test from 'ava';
import sinon from 'sinon';
import {
    Logger as log,
    logLevels,
    NodeInstructionUrlHelper,
} from 'solarnetwork-api-core';
import { 
    TestAuthorizationV2Builder as TestAuthBuilder,
    testRequest
} from 'solarnetwork-test-utils';

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
    ControlTogger.__Rewire__('xhrRequest', testRequest(xhr).request);
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
    t.truthy(toggler.queryUrlHelper, 'query UrlHelper created');
    t.is(toggler.queryUrlHelper.nodeId, TEST_NODE_ID, 'node ID assigned');
    t.is(toggler.queryUrlHelper.sourceId, TEST_CONTROL_ID, 'source ID assigned');
});

test.serial('setValue', t => {
    const toggler = new ControlTogger(t.context.urlHelper, t.context.auth, TEST_CONTROL_ID);

    /** @type {sinon.SinonFakeXMLHttpRequest[]} */
    const reqs = t.context.requests;

    toggler.value(1);

    t.is(reqs.length, 1);

    const queueReq = reqs[0];
    t.is(queueReq.method, 'POST');
    t.is(queueReq.url, "https://localhost/solaruser/api/v1/sec/instr/add");
    t.is(queueReq.requestBody, 'nodeId=123&topic=SetControlParameter&parameters%5B0%5D.name=test-control&parameters%5B0%5D.value=1');
    t.deepEqual(queueReq.requestHeaders, {
        'Accept':'application/json',
        'X-SN-Date':TEST_DATE_STR,
        'Authorization':'SNWS2 Credential=test-token,SignedHeaders=content-type;host;x-sn-date,Signature=0e3806a471d5367b7e2ab914a85dbc3d1229c8eb37c4e41fbe10f2ec02902792',
    });
    queueReq.respond(200, { "Content-Type": "application/json" }, 
        '{"success":true,"data":' 
        +'{"id": 12345,"created": "2015-02-26 21:00:00.000Z","topic": "SetControlParameter","state": "Queued","parameters": [{"name": "test-control","value": "1"}]}'
        +'}');
    t.deepEqual(toggler.lastKnownInstruction, {
        id: 12345,
        created: "2015-02-26 21:00:00.000Z",
        topic: "SetControlParameter",
        state: "Queued",
        parameters: [
            {"name": "test-control","value": "1"}
        ]
    });
});

test.serial('setValue:alreadyPending', t => {
    const toggler = new ControlTogger(t.context.urlHelper, t.context.auth, TEST_CONTROL_ID);

    // force a pending Queued instruction
    toggler.lastKnownInstruction = {
        id: 12345,
        created: '2017-07-26 05:57:49.608Z',
        state: 'Queued',
        topic: 'SetControlParameter',
        parameters: [
            {name: 'test-control', value: '1'}
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
        topic: 'SetControlParameter',
        parameters: [
            {name: 'test-control', value: '0'}
        ]
    };

    /** @type {sinon.SinonFakeXMLHttpRequest[]} */
    const reqs = t.context.requests;

    toggler.value(1);

    t.is(reqs.length, 2, 'need to issue cancel request, followed by enqueue');

    const cancelReq = reqs[0];
    t.is(cancelReq.method, 'POST');
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
    t.is(queueReq.method, 'POST');
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

test.serial('update', t => {
    const toggler = new ControlTogger(t.context.urlHelper, t.context.auth, TEST_CONTROL_ID);

    /** @type {sinon.SinonFakeXMLHttpRequest[]} */
    const reqs = t.context.requests;

    toggler.update();

    t.is(reqs.length, 2, 'get most recent datum and view pending instructions');

    const datumReq = reqs[0];
    t.is(datumReq.method, 'GET');
    t.is(datumReq.url, "https://localhost/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control");
    t.deepEqual(datumReq.requestHeaders, {
        'Accept':'application/json',
        'X-SN-Date':TEST_DATE_STR,
        'Authorization':'SNWS2 Credential=test-token,SignedHeaders=host;x-sn-date,Signature=a68ae1d9b9343a000d615c861faa8f03d1913b8fc2a1895faa9f7ab93c386bb5',
    });
    datumReq.respond(200, { "Content-Type": "application/json" }, 
        '{"success":true,"data":' 
        +'{"totalResults": 1, "startingOffset": 0, "returnedResultCount": 1, "results": ['
            +'{"created": "2017-07-26 05:57:49.608Z","nodeId":123,"sourceId":"test-control","val":1}'
        +']}}');

    const pendingReq = reqs[1];
    t.is(pendingReq.method, 'GET');
    t.is(pendingReq.url, 'https://localhost/solaruser/api/v1/sec/instr/viewPending?nodeId=123');
    t.deepEqual(pendingReq.requestHeaders, {
        'Accept':'application/json',
        'X-SN-Date':TEST_DATE_STR,
        'Authorization':'SNWS2 Credential=test-token,SignedHeaders=host;x-sn-date,Signature=e44457f0dc787fdf7b18620ca934312578db21d4e8f9ac3511baaaf246d22983',
    });
    pendingReq.respond(200, { "Content-Type": "application/json" }, 
        '{"success":true,"data":[]}'); // nothing pending

    t.deepEqual(toggler.lastKnownDatum, {
        created: "2017-07-26 05:57:49.608Z",
        nodeId: 123,
        sourceId: "test-control",
        val: 1
    });

});

test.serial('update:noPendingLastKnownQueued', t => {
    const toggler = new ControlTogger(t.context.urlHelper, t.context.auth, TEST_CONTROL_ID);

    /** @type {sinon.SinonFakeXMLHttpRequest[]} */
    const reqs = t.context.requests;

    // force a pending Queued instruction, i.e. previously set via call to value(1)
    toggler.lastKnownInstruction = {
        id: 12345,
        created: '2017-07-26 05:58:00.000Z',
        state: 'Queued',
        topic: 'SetControlParameter',
        parameters: [
            {name: 'test-control', value: '1'}
        ]
    };

    toggler.update();

    t.is(reqs.length, 3, 'get most recent datum, view pending instructions, view instruction');

    const datumReq = reqs[0];
    t.is(datumReq.method, 'GET');
    t.is(datumReq.url, "https://localhost/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control");
    t.deepEqual(datumReq.requestHeaders, {
        'Accept':'application/json',
        'X-SN-Date':TEST_DATE_STR,
        'Authorization':'SNWS2 Credential=test-token,SignedHeaders=host;x-sn-date,Signature=a68ae1d9b9343a000d615c861faa8f03d1913b8fc2a1895faa9f7ab93c386bb5',
    });
    datumReq.respond(200, { "Content-Type": "application/json" }, 
        '{"success":true,"data":' 
        +'{"totalResults": 1, "startingOffset": 0, "returnedResultCount": 1, "results": ['
            +'{"created": "2017-07-26 05:57:49.608Z","nodeId":123,"sourceId":"test-control","val":0}' // datum still at 0
        +']}}');

    const pendingReq = reqs[1];
    t.is(pendingReq.method, 'GET');
    t.is(pendingReq.url, 'https://localhost/solaruser/api/v1/sec/instr/viewPending?nodeId=123');
    t.deepEqual(pendingReq.requestHeaders, {
        'Accept':'application/json',
        'X-SN-Date':TEST_DATE_STR,
        'Authorization':'SNWS2 Credential=test-token,SignedHeaders=host;x-sn-date,Signature=e44457f0dc787fdf7b18620ca934312578db21d4e8f9ac3511baaaf246d22983',
    });
    pendingReq.respond(200, { "Content-Type": "application/json" }, 
        '{"success":true,"data":[]}'); // nothing pending

    const instrReq = reqs[2];
    t.is(instrReq.method, 'GET');
    t.is(instrReq.url, 'https://localhost/solaruser/api/v1/sec/instr/view?id=12345');
    t.deepEqual(instrReq.requestHeaders, {
        'Accept':'application/json',
        'X-SN-Date':TEST_DATE_STR,
        'Authorization':'SNWS2 Credential=test-token,SignedHeaders=host;x-sn-date,Signature=d19a7d2c06ed848f2086ffc6045609094a88415672ab78459ba1374df6574de5',
    });
    instrReq.respond(200, { "Content-Type": "application/json" }, 
        '{"success":true,"data":'
        +'{"id": 12345,"created": "2017-07-26 05:58:00.000Z","topic": "SetControlParameter","state": "Completed","parameters": [{"name": "test-control","value": "1"}]}'
        +'}'); // state now Completed

    t.deepEqual(toggler.lastKnownDatum, {
        created: "2017-07-26 05:57:49.608Z",
        nodeId: 123,
        sourceId: "test-control",
        val: 1
    }, 'datum val forced to 1 from updated instruction result');
    t.deepEqual(toggler.lastKnownInstruction, {
        id: 12345,
        created: '2017-07-26 05:58:00.000Z',
        state: 'Completed',
        topic: 'SetControlParameter',
        parameters: [
            {name: 'test-control', value: '1'}
        ]
    });
});

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

test.serial('start', async t => {
    const toggler = new ControlTogger(t.context.urlHelper, t.context.auth, TEST_CONTROL_ID);

    toggler.start(10);
    t.truthy(toggler.timer, 'update timer set');
    await timeout(15);

    /** @type {sinon.SinonFakeXMLHttpRequest[]} */
    const reqs = t.context.requests;

    t.is(reqs.length, 2, 'get most recent datum and view pending instructions');

    const datumReq = reqs[0];
    t.is(datumReq.method, 'GET');
    t.is(datumReq.url, "https://localhost/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control");
    t.deepEqual(datumReq.requestHeaders, {
        'Accept':'application/json',
        'X-SN-Date':TEST_DATE_STR,
        'Authorization':'SNWS2 Credential=test-token,SignedHeaders=host;x-sn-date,Signature=a68ae1d9b9343a000d615c861faa8f03d1913b8fc2a1895faa9f7ab93c386bb5',
    });
    datumReq.respond(200, { "Content-Type": "application/json" }, 
        '{"success":true,"data":' 
        +'{"totalResults": 1, "startingOffset": 0, "returnedResultCount": 1, "results": ['
            +'{"created": "2017-07-26 05:57:49.608Z","nodeId":123,"sourceId":"test-control","val":1}'
        +']}}');

    const pendingReq = reqs[1];
    t.is(pendingReq.method, 'GET');
    t.is(pendingReq.url, 'https://localhost/solaruser/api/v1/sec/instr/viewPending?nodeId=123');
    t.deepEqual(pendingReq.requestHeaders, {
        'Accept':'application/json',
        'X-SN-Date':TEST_DATE_STR,
        'Authorization':'SNWS2 Credential=test-token,SignedHeaders=host;x-sn-date,Signature=e44457f0dc787fdf7b18620ca934312578db21d4e8f9ac3511baaaf246d22983',
    });
    pendingReq.respond(200, { "Content-Type": "application/json" }, 
        '{"success":true,"data":[]}'); // nothing pending

    t.deepEqual(toggler.lastKnownDatum, {
        created: "2017-07-26 05:57:49.608Z",
        nodeId: 123,
        sourceId: "test-control",
        val: 1
    });
});

test.serial('stop', t => {
    const toggler = new ControlTogger(t.context.urlHelper, t.context.auth, TEST_CONTROL_ID);

    toggler.start(10);
    t.truthy(toggler.timer, 'update timer set');

    toggler.stop();
    t.falsy(toggler.timer, 'update timer cleared');
});
