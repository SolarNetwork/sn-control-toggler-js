import anyTest, { TestFn } from "ava";
import { MockAgent, setGlobalDispatcher } from "undici";

import { Instruction } from "solarnetwork-api-core/lib/domain/index.js";
import {
	Logger as log,
	LogLevel,
} from "solarnetwork-api-core/lib/util/index.js";
import {
	AuthorizationV2Builder,
	SolarQueryApi,
	SolarUserApi,
} from "solarnetwork-api-core/lib/net/index.js";

import ControlTogger, {
	ControlCallbackFn,
	type ControlValueType,
} from "../main/controlToggler.js";

const test = anyTest as TestFn<{
	agent: MockAgent;
	api: SolarUserApi;
	queryApi: SolarQueryApi;
	auth: AuthorizationV2Builder;
}>;

log.level = LogLevel.DEBUG;

const TEST_CONTROL_ID = "test-control";
const TEST_TOKEN_ID = "test-token";
const TEST_TOKEN_SECRET = "secret";
const TEST_NODE_ID = 123;

const AUTH_POST_REGEX =
	/^SNWS2 Credential=test-token,SignedHeaders=content-type;host;x-sn-date,Signature=/;

const AUTH_GET_REGEX =
	/^SNWS2 Credential=test-token,SignedHeaders=host;x-sn-date,Signature=/;

test.beforeEach((t) => {
	const agent = new MockAgent();
	agent.disableNetConnect();
	setGlobalDispatcher(agent);
	const api = new SolarUserApi({ protocol: "http", host: "localhost" });
	t.context = {
		agent: agent,
		api: api,
		queryApi: new SolarQueryApi(api.environment),
		auth: new AuthorizationV2Builder(TEST_TOKEN_ID).saveSigningKey(
			TEST_TOKEN_SECRET
		),
	};
});

function createToggler(
	api: SolarUserApi,
	auth: AuthorizationV2Builder,
	queryApi?: SolarQueryApi
): ControlTogger {
	return new ControlTogger(
		api,
		auth,
		TEST_NODE_ID,
		TEST_CONTROL_ID,
		queryApi
	);
}

test("construct", (t) => {
	t.context;
	const toggler = createToggler(t.context.api, t.context.auth);
	t.truthy(toggler);
	t.is(toggler.nodeId, TEST_NODE_ID, "node ID assigned");
	t.is(toggler.controlId, TEST_CONTROL_ID, "control ID assigned");
});

test.serial("setValue", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	const result = {
		id: 12345,
		created: "2015-02-26 21:00:00.000Z",
		topic: "SetControlParameter",
		state: "Queued",
		parameters: [{ name: "test-control", value: "1" }],
	};
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/add/SetControlParameter",
		method: "POST",
		body: "nodeId=123&parameters%5B0%5D.name=test-control&parameters%5B0%5D.value=1",
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
			authorization: AUTH_POST_REGEX,
		},
	}).reply(200, {
		success: true,
		data: result,
	});

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);
	const info = await toggler.value(1);

	// THEN
	t.deepEqual(
		info,
		result,
		"set value promise resolves to instruction add response"
	);
	t.is(
		toggler.hasPendingStateChange,
		true,
		"pending instruction confirmation"
	);
});

test.serial("setValue:queuing", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	const result = {
		id: 12345,
		created: "2015-02-26 21:00:00.000Z",
		topic: "SetControlParameter",
		state: "Queuing",
		parameters: [{ name: "test-control", value: "1" }],
	};
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/add/SetControlParameter",
		method: "POST",
		body: "nodeId=123&parameters%5B0%5D.name=test-control&parameters%5B0%5D.value=1",
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
			authorization: AUTH_POST_REGEX,
		},
	}).reply(200, {
		success: true,
		data: result,
	});

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);
	const info = await toggler.value(1);

	// THEN
	t.deepEqual(
		info,
		result,
		"set value promise resolves to instruction add response"
	);
	t.is(
		toggler.hasPendingStateChange,
		true,
		"pending instruction confirmation"
	);
});

test.serial("setValue:httpErrorCode", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/add/SetControlParameter",
		method: "POST",
		body: "nodeId=123&parameters%5B0%5D.name=test-control&parameters%5B0%5D.value=1",
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
			authorization: AUTH_POST_REGEX,
		},
	}).reply(500);

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);

	const error = await t.throwsAsync(toggler.value(1));
	// THEN
	t.regex(
		error.message,
		/^HTTP 500: /,
		"error message starts with HTTP error code"
	);
	t.is(
		toggler.hasPendingStateChange,
		false,
		"pending instruction confirmation"
	);
});

test.serial("setValue:invalidCredentials", async (t) => {
	// GIVEN

	// WHEN
	const toggler = createToggler(
		t.context.api,
		new AuthorizationV2Builder(TEST_TOKEN_ID)
	);

	const error = await t.throwsAsync(toggler.value(1));

	// THEN
	t.is(error.message, "Valid credentials not configured");
});

test.serial("setValue:httpErrorCode:withMessage", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/add/SetControlParameter",
		method: "POST",
		body: "nodeId=123&parameters%5B0%5D.name=test-control&parameters%5B0%5D.value=1",
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
			authorization: AUTH_POST_REGEX,
		},
	}).reply(403, {
		success: false,
		message: "Bad credentials",
	});

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);

	const error = await t.throwsAsync(toggler.value(1));
	// THEN
	t.is(error.message, "Bad credentials");
	t.is(
		toggler.hasPendingStateChange,
		false,
		"pending instruction confirmation"
	);
});

test.serial("setValue:httpErrorCode:noMessage:withCode", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/add/SetControlParameter",
		method: "POST",
		body: "nodeId=123&parameters%5B0%5D.name=test-control&parameters%5B0%5D.value=1",
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
			authorization: AUTH_POST_REGEX,
		},
	}).reply(503, {
		success: false,
		code: "123.ABC",
	});

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);

	const error = await t.throwsAsync(toggler.value(1));
	// THEN
	t.is(error.message, "HTTP 503 (123.ABC)");
	t.is(
		toggler.hasPendingStateChange,
		false,
		"pending instruction confirmation"
	);
});

test.serial("setValue:alreadyPending", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	const result = {
		id: 12345,
		created: "2015-02-26 21:00:00.000Z",
		topic: "SetControlParameter",
		state: "Queued",
		parameters: [{ name: "test-control", value: "1" }],
	};
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/add/SetControlParameter",
		method: "POST",
		body: "nodeId=123&parameters%5B0%5D.name=test-control&parameters%5B0%5D.value=1",
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
			authorization: AUTH_POST_REGEX,
		},
	}).reply(200, {
		success: true,
		data: result,
	});

	const callbackValues: Array<ControlValueType | undefined> = [];
	const callback: ControlCallbackFn = function (error) {
		t.falsy(error, "no error reported");
		callbackValues.push(this.value());
	};

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);
	toggler.callback = callback;
	const info1 = await toggler.value(1);

	// set again
	const info2 = await toggler.value(1);

	// THEN
	t.like(info2, info1, "Same info returned.");
	t.true(
		info2 instanceof Instruction,
		"2nd info is last know instruction instance"
	);
	t.deepEqual(callbackValues, [undefined]);
});

test.serial("setValue:differentPending", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	const results = [
		{
			id: 12345,
			created: "2017-07-26 05:57:49.608Z",
			topic: "SetControlParameter",
			state: "Queued",
			parameters: [{ name: "test-control", value: "0" }],
		},
		{
			id: 12346,
			created: "2017-07-26 05:58:49.608Z",
			topic: "SetControlParameter",
			state: "Queued",
			parameters: [{ name: "test-control", value: "1" }],
		},
	];

	// first set control to 0
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/add/SetControlParameter",
		method: "POST",
		body: "nodeId=123&parameters%5B0%5D.name=test-control&parameters%5B0%5D.value=0",
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
			authorization: AUTH_POST_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[0],
	});

	// then cancel that instruction
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/updateState",
		method: "POST",
		body: "id=12345&state=Declined",
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
			authorization: AUTH_POST_REGEX,
		},
	}).reply(200, {
		success: true,
	});

	// then set control to 1
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/add/SetControlParameter",
		method: "POST",
		body: "nodeId=123&parameters%5B0%5D.name=test-control&parameters%5B0%5D.value=1",
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
			authorization: AUTH_POST_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[1],
	});

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);

	// force a pending Queued instruction
	const info1 = await toggler.value(0);

	// now set to different value
	const info2 = await toggler.value(1);

	t.deepEqual(
		info1,
		results[0],
		"set value 0 promise resolves to instruction add response"
	);
	t.deepEqual(
		info2,
		results[1],
		"set value 1 promise resolves to instruction add response"
	);
	t.is(
		toggler.hasPendingStateChange,
		true,
		"pending instruction confirmation"
	);
});

test.serial("update:invalidCredentials", async (t) => {
	// GIVEN

	// WHEN
	const toggler = createToggler(
		t.context.api,
		new AuthorizationV2Builder(TEST_TOKEN_ID)
	);

	const error = await t.throwsAsync(toggler.update());

	// THEN
	t.is(error.message, "Valid credentials not configured");
});

test.serial("update", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	const results = [
		{
			totalResults: 1,
			startingOffset: 0,
			returnedResultCount: 1,
			results: [
				{
					created: "2017-07-26 05:57:49.608Z",
					nodeId: 123,
					sourceId: "test-control",
					val: 3,
				},
			],
		},
	];

	// first query for most-recent value
	http.intercept({
		path: "/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[0],
	});

	// then view pending instructions
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/viewPending?nodeId=123",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: [],
	});

	const callbackValues: Array<ControlValueType | undefined> = [];
	const callback: ControlCallbackFn = function (error) {
		t.falsy(error, "no error reported");
		callbackValues.push(this.value());
	};

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);
	toggler.callback = callback;
	const result = await toggler.update();

	t.false(toggler.hasPendingStateChange, "no pending change");
	t.is(
		result,
		results[0].results[0].val,
		"resolved value is from most recent response"
	);
	t.is(
		toggler.value(),
		results[0].results[0].val,
		"current value is from most recent response"
	);
	t.deepEqual(
		callbackValues,
		[results[0].results[0].val],
		"callback invoked"
	);
});

test.serial("update:alternateQueryApi", async (t) => {
	// GIVEN
	const httpQuery = t.context.agent.get("http://query.local");
	const results = [
		{
			totalResults: 1,
			startingOffset: 0,
			returnedResultCount: 1,
			results: [
				{
					created: "2017-07-26 05:57:49.608Z",
					nodeId: 123,
					sourceId: "test-control",
					val: 3,
				},
			],
		},
	];

	// first query for most-recent value
	httpQuery
		.intercept({
			path: "/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control",
			method: "GET",
			headers: {
				accept: "application/json",
				authorization: AUTH_GET_REGEX,
			},
		})
		.reply(200, {
			success: true,
			data: results[0],
		});

	// then view pending instructions
	const httpUser = t.context.agent.get("http://user.local");
	httpUser
		.intercept({
			path: "/solaruser/api/v1/sec/instr/viewPending?nodeId=123",
			method: "GET",
			headers: {
				accept: "application/json",
				authorization: AUTH_GET_REGEX,
			},
		})
		.reply(200, {
			success: true,
			data: [],
		});

	const callbackValues: Array<ControlValueType | undefined> = [];
	const callback: ControlCallbackFn = function (error) {
		t.falsy(error, "no error reported");
		callbackValues.push(this.value());
	};

	// WHEN
	const userApi = new SolarUserApi(new URL("http://user.local"));
	const userAuth = new AuthorizationV2Builder(TEST_TOKEN_ID).saveSigningKey(
		TEST_TOKEN_SECRET
	);
	const queryApi = new SolarQueryApi(new URL("http://query.local"));
	const toggler = createToggler(userApi, userAuth, queryApi);
	toggler.callback = callback;
	const result = await toggler.update();

	t.false(toggler.hasPendingStateChange, "no pending change");
	t.is(
		result,
		results[0].results[0].val,
		"resolved value is from most recent response"
	);
	t.is(
		toggler.value(),
		results[0].results[0].val,
		"current value is from most recent response"
	);
	t.deepEqual(
		callbackValues,
		[results[0].results[0].val],
		"callback invoked"
	);
});

test.serial("update:callbackThrowsError", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	const results = [
		{
			totalResults: 1,
			startingOffset: 0,
			returnedResultCount: 1,
			results: [
				{
					created: "2017-07-26 05:57:49.608Z",
					nodeId: 123,
					sourceId: "test-control",
					val: 3,
				},
			],
		},
	];

	// first query for most-recent value
	http.intercept({
		path: "/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[0],
	});

	// then view pending instructions
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/viewPending?nodeId=123",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: [],
	});

	const callbackValues: Array<ControlValueType | undefined> = [];
	const callback: ControlCallbackFn = function (error) {
		t.falsy(error, "no error reported");
		callbackValues.push(this.value());
		throw new Error("Whoops!");
	};

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);
	toggler.callback = callback;
	const result = await toggler.update();

	t.false(toggler.hasPendingStateChange, "no pending change");
	t.is(
		result,
		results[0].results[0].val,
		"resolved value is from most recent response"
	);
	t.is(
		toggler.value(),
		results[0].results[0].val,
		"current value is from most recent response"
	);
	t.deepEqual(
		callbackValues,
		[results[0].results[0].val],
		"callback invoked"
	);
});

test.serial("update:noPendingLastKnownQueued", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	const results = [
		// set value 1
		{
			id: 12345,
			created: "2017-07-26 05:57:49.608Z",
			topic: "SetControlParameter",
			state: "Queued",
			parameters: [{ name: "test-control", value: "1" }],
		},
		// most recent value, still at 0
		{
			totalResults: 1,
			startingOffset: 0,
			returnedResultCount: 1,
			results: [
				{
					created: "2017-07-26 05:57:49.608Z",
					nodeId: 123,
					sourceId: "test-control",
					val: 0,
				},
			],
		},
		// view instruction; now complted and updated to 1
		{
			id: 12345,
			created: "2017-07-26 05:58:00.000Z",
			topic: "SetControlParameter",
			state: "Completed",
			parameters: [{ name: "test-control", value: "1" }],
		},
	];

	// set control to 1
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/add/SetControlParameter",
		method: "POST",
		body: "nodeId=123&parameters%5B0%5D.name=test-control&parameters%5B0%5D.value=1",
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
			authorization: AUTH_POST_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[0],
	});

	// query for most-recent value
	http.intercept({
		path: "/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[1],
	});

	// view pending instructions (none pending)
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/viewPending?nodeId=123",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: [],
	});

	// view previous instruction (now completed)
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/view?id=12345",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[2],
	});

	const callbackValues: Array<ControlValueType | undefined> = [];
	const callback: ControlCallbackFn = function (error) {
		t.falsy(error, "no error reported");
		if (callbackValues.length == 0) {
			// should be pending here
			t.true(
				this.hasPendingStateChange,
				"first callback from pending change"
			);
		} else {
			t.false(
				this.hasPendingStateChange,
				"2nd callback after change complete"
			);
		}
		callbackValues.push(this.value());
	};

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);
	toggler.callback = callback;

	// force a pending Queued instruction
	await toggler.value(1);

	const result = await toggler.update();

	// THEN
	t.false(toggler.hasPendingStateChange, "no pending change");
	t.is(result, "1", "resolved value is from updated instruction");
	t.is(toggler.value(), "1", "current value is from updated instruction");
	t.deepEqual(callbackValues, [undefined, "1"], "callback invoked");
});

test.serial("update:activePending", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	const results = [
		// most recent value, still at 0
		{
			totalResults: 1,
			startingOffset: 0,
			returnedResultCount: 1,
			results: [
				{
					created: "2017-07-26 05:57:49.608Z",
					nodeId: 123,
					sourceId: "test-control",
					val: 0,
				},
			],
		},
		// view pending
		[
			{
				id: 12345,
				created: "2017-07-26 05:57:49.608Z",
				topic: "SetControlParameter",
				state: "Queued",
				parameters: [{ name: "test-control", value: "1" }],
			},
		],
	];

	// query for most-recent value
	http.intercept({
		path: "/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[0],
	});

	// view pending instructions (find pending)
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/viewPending?nodeId=123",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[1],
	});

	const callbackValues: Array<ControlValueType | undefined> = [];
	const callback: ControlCallbackFn = function (error) {
		t.falsy(error, "no error reported");
		if (callbackValues.length == 0) {
			// should be pending here
			t.true(
				this.hasPendingStateChange,
				"first callback from pending change"
			);
		} else {
			t.false(
				this.hasPendingStateChange,
				"2nd callback after change complete"
			);
		}
		callbackValues.push(this.value());
	};

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);
	toggler.callback = callback;

	const result = await toggler.update();

	// THEN
	t.true(toggler.hasPendingStateChange, "has pending change");
	t.is(result, 0, "resolved value is from most recent datum");
	t.is(toggler.value(), 0, "current value is from most recent datum");
	t.deepEqual(callbackValues, [0], "callback invoked");
});

test.serial("update:activePending:multi", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	const results = [
		// most recent value, still at 0
		{
			totalResults: 1,
			startingOffset: 0,
			returnedResultCount: 1,
			results: [
				{
					created: "2017-07-26 05:57:49.608Z",
					nodeId: 123,
					sourceId: "test-control",
					val: 0,
				},
			],
		},
		// view pending
		[
			{
				id: 12345,
				created: "2017-07-26 05:57:49.608Z",
				topic: "SetControlParameter",
				state: "Queued",
				parameters: [{ name: "some-other-control", value: "1" }],
			},
			{
				id: 12346,
				created: "2017-07-26 05:57:51.608Z",
				topic: "SetControlParameter",
				state: "Queued",
				parameters: [{ name: "test-control", value: "2" }],
			},
			{
				id: 12347,
				created: "2017-07-26 05:57:52.608Z",
				topic: "SetControlParameter",
				state: "Queued",
				parameters: [{ name: "test-control", value: "3" }],
			},
		],
		// most recent value, still at 0
		{
			totalResults: 1,
			startingOffset: 0,
			returnedResultCount: 1,
			results: [
				{
					created: "2017-07-26 05:57:49.608Z",
					nodeId: 123,
					sourceId: "test-control",
					val: 0,
				},
			],
		},
		// view previous pending (Complete)
		{
			id: 12347,
			created: "2017-07-26 05:57:52.608Z",
			topic: "SetControlParameter",
			state: "Complete",
			parameters: [{ name: "test-control", value: "3" }],
		},
	];

	// UPDATE 1

	// query for most-recent value
	http.intercept({
		path: "/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[0],
	});

	// view pending instructions (find pending)
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/viewPending?nodeId=123",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[1],
	});

	// UPDATE 2

	// query for most-recent value
	http.intercept({
		path: "/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[2],
	});

	// view pending instructions (none pending)
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/viewPending?nodeId=123",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: [],
	});

	// view previous instruction (now completed)
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/view?id=12347",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[3],
	});

	const callbackValues: Array<ControlValueType | undefined> = [];
	const callback: ControlCallbackFn = function (error) {
		t.falsy(error, "no error reported");
		if (callbackValues.length == 0) {
			// should be pending here
			t.true(
				this.hasPendingStateChange,
				"first callback from pending change"
			);
		} else {
			t.false(
				this.hasPendingStateChange,
				"2nd callback after change complete"
			);
		}
		callbackValues.push(this.value());
	};

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);
	toggler.callback = callback;

	const result = await toggler.update();

	// THEN
	t.true(toggler.hasPendingStateChange, "has pending change");
	t.is(result, 0, "resolved value is from most recent datum");
	t.is(toggler.value(), 0, "current value is from most recent datum");

	// WHEN
	const result2 = await toggler.update();

	// THEN
	t.false(toggler.hasPendingStateChange, "no pending change");
	t.is(result2, "3", "resolved value is from completed instruction");
	t.is(toggler.value(), "3", "current value is from completed instruction");

	t.deepEqual(callbackValues, [0, "3"], "callback invoked");
});

test.serial("update:pending:other", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	const results = [
		// most recent value, still at 0
		{
			totalResults: 1,
			startingOffset: 0,
			returnedResultCount: 1,
			results: [
				{
					created: "2017-07-26 05:57:49.608Z",
					nodeId: 123,
					sourceId: "test-control",
					val: 0,
				},
			],
		},
		// view pending
		[
			{
				id: 12345,
				created: "2017-07-26 05:57:49.608Z",
				topic: "SetControlParameter",
				state: "Queued",
				parameters: [{ name: "some-other-control", value: "1" }],
			},
		],
	];

	// query for most-recent value
	http.intercept({
		path: "/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[0],
	});

	// view pending instructions (find pending)
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/viewPending?nodeId=123",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[1],
	});

	const callbackValues: Array<ControlValueType | undefined> = [];
	const callback: ControlCallbackFn = function (error) {
		t.falsy(error, "no error reported");
		t.false(
			this.hasPendingStateChange,
			"2nd callback after change complete"
		);
		callbackValues.push(this.value());
	};

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);
	toggler.callback = callback;

	const result = await toggler.update();

	// THEN
	t.false(toggler.hasPendingStateChange, "no pending change");
	t.is(result, 0, "resolved value is from most recent datum");
	t.is(toggler.value(), 0, "current value is from most recent datum");
	t.deepEqual(callbackValues, [0], "callback invoked");
});

test.serial("update:pending:noMostRecent", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	const results = [
		// view pending
		[
			{
				id: 12345,
				created: "2017-07-26 05:57:49.608Z",
				topic: "SetControlParameter",
				state: "Queued",
				parameters: [{ name: "test-control", value: "1" }],
			},
		],
	];

	// query for most-recent value
	http.intercept({
		path: "/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: [],
	});

	// view pending instructions (find pending)
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/viewPending?nodeId=123",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[0],
	});

	const callbackValues: Array<ControlValueType | undefined> = [];
	const callback: ControlCallbackFn = function (error) {
		t.falsy(error, "no error reported");
		t.true(this.hasPendingStateChange, "has pending");
		callbackValues.push(this.value());
	};

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);
	toggler.callback = callback;

	const result = await toggler.update();

	// THEN
	t.true(toggler.hasPendingStateChange, "has pending change");
	t.is(result, undefined, "resolved value not defined");
	t.is(toggler.value(), undefined, "current value is undefined");
	t.deepEqual(callbackValues, [undefined], "callback invoked");
});

function timeout(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test.serial("start", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	const results = [
		// most recent value
		{
			totalResults: 1,
			startingOffset: 0,
			returnedResultCount: 1,
			results: [
				{
					created: "2017-07-26 05:57:49.608Z",
					nodeId: 123,
					sourceId: "test-control",
					val: 1,
				},
			],
		},
	];

	// query for most-recent value
	http.intercept({
		path: "/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[0],
	});

	// view pending instructions (none pending)
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/viewPending?nodeId=123",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: [],
	});

	const callbackValues: Array<ControlValueType | undefined> = [];
	const callback: ControlCallbackFn = function (error) {
		t.falsy(error, "no error reported");
		t.false(this.hasPendingStateChange, "no pending changes");
		callbackValues.push(this.value());
	};

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);
	toggler.callback = callback;
	toggler.start(10);

	// THEN
	// sleep past start delay
	await timeout(100);
	toggler.stop();

	t.false(toggler.hasPendingStateChange, "no pending change");
	t.is(toggler.value(), 1, "most recent datum value returned");
	t.deepEqual(callbackValues, [1], "callback invoked for update");
});

test.serial("stop", async (t) => {
	// GIVEN
	const http = t.context.agent.get("http://localhost");
	const results = [
		// most recent value
		{
			totalResults: 1,
			startingOffset: 0,
			returnedResultCount: 1,
			results: [
				{
					created: "2017-07-26 05:57:49.608Z",
					nodeId: 123,
					sourceId: "test-control",
					val: 1,
				},
			],
		},
		{
			totalResults: 1,
			startingOffset: 0,
			returnedResultCount: 1,
			results: [
				{
					created: "2017-07-26 05:58:00.000Z",
					nodeId: 123,
					sourceId: "test-control",
					val: 2,
				},
			],
		},
	];

	// query for most-recent value
	http.intercept({
		path: "/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[0],
	});

	// view pending instructions (none pending)
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/viewPending?nodeId=123",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: [],
	});

	// query for most-recent value
	http.intercept({
		path: "/solarquery/api/v1/sec/datum/mostRecent?nodeId=123&sourceId=test-control",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: results[1],
	});

	// view pending instructions (none pending)
	http.intercept({
		path: "/solaruser/api/v1/sec/instr/viewPending?nodeId=123",
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: AUTH_GET_REGEX,
		},
	}).reply(200, {
		success: true,
		data: [],
	});

	const callbackValues: Array<ControlValueType | undefined> = [];
	const callback: ControlCallbackFn = function () {
		t.false(this.hasPendingStateChange, "no pending changes");
		callbackValues.push(this.value());
	};

	// WHEN
	const toggler = createToggler(t.context.api, t.context.auth);
	toggler.callback = callback;
	toggler.refreshMs = 100;
	toggler.start(10);

	// THEN
	// sleep past start delay
	await timeout(215);
	toggler.stop();
	await timeout(300); // wait, should be no more updates

	t.false(toggler.hasPendingStateChange, "no pending change");
	t.is(toggler.value(), 2, "most recent datum value returned");
	t.deepEqual(callbackValues, [1, 2], "callback invoked for each update");
});
