import test, { mock } from "node:test";
import assert from "node:assert/strict";

mock.module("../../db/index.js", { namedExports: { sql: () => Promise.resolve([]) } });
mock.module("@doable/db", { namedExports: { isMessageEncryptionEnabled: () => false } });
mock.module("../../ai/yjs-bridge.js", { namedExports: { broadcastToRoom: async () => {} } });
const { createProcessEvent } = await import("./event-processor.js");
const { createInitialState } = await import("./types.js");
const { ChannelTokenRouter } = await import("../../ai/sse-mapper.js");

function harness() {
  const state = createInitialState();
  const frames: Array<{ type: string; data: unknown }> = [];
  const stream = { writeSSE: async (frame: { data: string }) => { frames.push(JSON.parse(frame.data)); } };
  const process = createProcessEvent(stream as never, state, new ChannelTokenRouter(), "test-project", "test-user", "test-message", "plan", () => {}, () => {}, () => "test-session");
  const emit = (type: string, data: Record<string, unknown>) => process({ type, data } as never);
  const tool = () => {
    emit("tool.execution_start", { toolCallId: "tool-1", toolName: "read_file", arguments: { path: "src/App.tsx" } });
    emit("tool.execution_complete", { toolCallId: "tool-1", success: true, result: { content: "test" } });
  };
  const delta = (id: string, text: string) => emit("assistant.message_delta", { messageId: id, deltaContent: text });
  const finish = (id: string, content: string) => emit("assistant.message", { messageId: id, content, toolRequests: [] });
  return { state, frames, emit, tool, delta, finish };
}

test("final answer after a tool is visible, preserves earlier reasoning and is not duplicated", () => {
  const h = harness();
  h.delta("before", "Vou consultar o arquivo.");
  h.tool();
  h.delta("final", "O banco já está conectado.");
  h.finish("final", "O banco já está conectado.");
  h.finish("final", "O banco já está conectado.");
  assert.equal(h.state.assistantContent, "O banco já está conectado.");
  assert.equal(h.state.assistantThinking, "Vou consultar o arquivo.");
  assert.equal(h.state.leadingTextBuffer, "");
  assert.equal(h.frames.filter(f => f.type === "thinking_to_text").length, 1);
});

test("final-only delivery is not swallowed by previous cumulative thinking", () => {
  const h = harness();
  h.delta("before", "Investigando ".repeat(100));
  h.tool();
  h.finish("final", "Resposta curta.");
  assert.equal(h.state.assistantContent, "Resposta curta.");
  assert.equal(h.frames.filter(f => f.type === "thinking_to_text").length, 0);
});

test("partial delivery catches up the final answer after tools", () => {
  const h = harness(); h.tool();
  h.delta("final", "Banco ");
  h.finish("final", "Banco conectado.");
  assert.equal(h.state.assistantContent, "Banco conectado.");
  assert.deepEqual(h.frames.filter(f => ["thinking_to_text", "text_delta"].includes(f.type)), [{type:"thinking_to_text",data:"Banco "},{type:"text_delta",data:"conectado."}]);
  assert.equal(h.state.assistantThinking, "");
});

test("tagged and native reasoning never become final text", () => {
  const h = harness(); h.tool();
  h.emit("assistant.reasoning_delta", { deltaContent: "Native reasoning." });
  h.delta("final", "<think>Internal thought.</think>Resposta pública.");
  h.finish("final", "<think>Internal thought.</think>Resposta pública.");
  assert.equal(h.state.assistantContent, "Resposta pública.");
  assert.match(h.state.assistantThinking, /Native reasoning/);
  assert.match(h.state.assistantThinking, /Internal thought/);
});

test("tool-bearing messages remain buffered and aborted tool runs do not promote text", () => {
  const h = harness();
  h.delta("before", "Preciso consultar.");
  h.emit("assistant.message", { messageId: "before", content: "Preciso consultar.", toolRequests: [{ name: "read_file" }] });
  assert.equal(h.state.assistantContent, "");
  h.tool(); h.delta("after", "Ainda trabalhando.");
  h.emit("session.error", { message: "timeout" });
  assert.equal(h.state.assistantContent, "");
});

test("plain chat without tools still produces its answer", () => {
  const h = harness(); h.delta("final", "Olá!"); h.finish("final", "Olá!");
  assert.equal(h.state.assistantContent, "Olá!");
  assert.equal(h.state.assistantThinking, "");
});

test("unfinished tagged reasoning is not exposed", () => {
  const h = harness(); h.tool();
  h.delta("final", "<think>still thinking"); h.finish("final", "<think>still thinking");
  assert.equal(h.state.assistantContent, "");
});


test("legacy message without toolRequests keeps post-tool narration hidden", () => {
  const h = harness(); h.tool(); h.delta("final", "Still considering.");
  h.emit("assistant.message", { messageId: "final", content: "Still considering." });
  assert.equal(h.state.assistantContent, "");
  assert.equal(h.frames.filter(f => f.type === "thinking_to_text").length, 0);
});

test("held partial marker is consumed by authoritative final message without duplication", () => {
  const h = harness(); h.tool(); h.delta("final", "Use <"); h.finish("final", "Use <");
  assert.equal(h.state.assistantContent, "Use <");
});

test("long answer already streamed is not duplicated at completion", () => {
  const h = harness(); h.tool();
  const answer = "Resposta longa. ".repeat(600);
  h.delta("final", answer); h.finish("final", answer);
  assert.equal(h.state.assistantContent, answer);
});

test("later final messages preserve earlier visible content", () => {
  const h = harness();
  h.delta("first", "Primeira resposta."); h.finish("first", "Primeira resposta.");
  h.tool(); h.delta("second", "Segunda resposta."); h.finish("second", "Segunda resposta.");
  assert.equal(h.state.assistantContent, "Primeira resposta.\n\nSegunda resposta.");
});
