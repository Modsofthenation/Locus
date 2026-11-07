import { nanoid } from 'nanoid';
import type { Port, Workflow, WorkflowNode } from './schema/index.js';
import { createEmptyWorkflow, createNode, createEdge, templateAt } from './workflow.js';

export interface WorkflowTemplateSource {
  pattern: string;
  inspiredBy: string;
  url: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  source?: WorkflowTemplateSource;
  create: () => Workflow;
}

function variable(
  name: string,
  description: string,
  defaultValue: unknown,
  type: 'string' | 'object' = 'string',
) {
  return {
    id: nanoid(),
    name,
    type,
    required: true,
    secret: false as const,
    scope: 'workflow' as const,
    description,
    defaultValue,
  };
}

function extraPorts(node: WorkflowNode, outputs: Port[]): WorkflowNode {
  node.data.outputs = [...node.data.outputs, ...outputs];
  return node;
}

const port = (id: string, name: string): Port => ({
  id,
  name,
  type: 'any',
  required: false,
});

const SEARCH_SCHEMA = `{
  "type": "object",
  "required": ["query"],
  "properties": {
    "query": { "type": "string" }
  }
}`;

const QUERY_MESSAGE_SCHEMA = `{
  "type": "object",
  "required": ["message"],
  "properties": {
    "message": { "type": "string" }
  }
}`;

/** Research agent template matching the product north-star example */
export function createResearchAgentTemplate(): Workflow {
  const workflow = createEmptyWorkflow('Research Agent');
  workflow.description =
    'Receive a question, research, evaluate sufficiency, and generate a report';
  workflow.tags = ['template', 'research', 'langgraph'];

  const start = createNode('input', templateAt(0), 'Receive Question');
  const research = createNode('agent', templateAt(1), 'Research Agent');
  research.data.config = {
    ...research.data.config,
    systemPrompt:
      'You are a thorough research agent. Gather facts, cite sources, and note gaps.',
    goal: '{{input.message}}',
    maxIterations: 6,
    tools: ['web_search'],
    model: { provider: 'openai', model: 'gpt-4o', temperature: 0.3 },
  };
  research.data.configSummary = 'Model: gpt-4o · Tools: web_search';

  const evaluate = createNode('evaluator', templateAt(2), 'Evaluate Research');
  evaluate.data.config = { ...evaluate.data.config, threshold: 0.7 };

  const generate = createNode('summarizer', templateAt(3), 'Generate Report');
  generate.data.config = {
    ...generate.data.config,
    systemPrompt: 'Write a clear research report with findings and sources.',
  };

  const end = createNode('output', templateAt(4), 'END');

  workflow.nodes = [start, research, evaluate, generate, end];
  workflow.edges = [
    createEdge(start.id, research.id),
    createEdge(research.id, evaluate.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'result', targetPort: 'result' },
    }),
    createEdge(evaluate.id, research.id, {
      kind: 'conditional',
      sourceHandle: 'insufficient',
      targetHandle: 'goal',
      label: 'insufficient',
    }),
    createEdge(evaluate.id, generate.id, {
      kind: 'conditional',
      sourceHandle: 'sufficient',
      label: 'sufficient',
    }),
    createEdge(generate.id, end.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'summary', targetPort: 'value' },
    }),
  ];
  workflow.variables = [
    variable(
      'message',
      'Research question',
      'What are the latest advances in agentic workflows?',
    ),
  ];
  workflow.updatedAt = new Date().toISOString();
  return workflow;
}

export function createCustomerSupportTemplate(): Workflow {
  const wf = createEmptyWorkflow('Customer Support Agent');
  wf.description = 'Classify a request, look up context, and draft a reply';
  wf.tags = ['template', 'support', 'crewai'];
  const input = createNode('input', templateAt(0), 'Customer Message');
  const classify = createNode('classifier', templateAt(1), 'Classify Request');
  classify.data.config = {
    ...classify.data.config,
    labels: ['billing', 'technical', 'general'],
    mockLabel: 'technical',
  };
  const lookup = createNode('agent', templateAt(2), 'Knowledge Lookup');
  lookup.data.config = {
    ...lookup.data.config,
    systemPrompt: 'Look up account and product context needed to answer the request.',
  };
  const respond = createNode('agent', templateAt(3), 'Response Generation');
  const output = createNode('output', templateAt(4), 'Reply');
  wf.nodes = [input, classify, lookup, respond, output];
  wf.edges = [
    createEdge(input.id, classify.id),
    createEdge(classify.id, lookup.id),
    createEdge(lookup.id, respond.id),
    createEdge(respond.id, output.id),
  ];
  wf.variables = [variable('message', 'Customer message', 'My invoice looks wrong')];
  return wf;
}

export function createHitlApprovalTemplate(): Workflow {
  const wf = createEmptyWorkflow('HITL Approval');
  wf.description = 'Draft, pause for a human, then publish through an approved gate';
  wf.tags = ['template', 'hitl', 'langgraph'];
  const input = createNode('input', templateAt(0), 'Request');
  const draft = createNode('llm', templateAt(1), 'Draft Content');
  const approve = createNode('human_approval', templateAt(2), 'Manager Approval');
  const publish = createNode('http_request', templateAt(3), 'Publish');
  publish.data.config = {
    ...publish.data.config,
    method: 'POST',
    url: 'https://example.com/publish',
    urlAllowlist: 'https://example.com/publish',
  };
  const output = createNode('output', templateAt(4), 'Published');
  wf.nodes = [input, draft, approve, publish, output];
  wf.edges = [
    createEdge(input.id, draft.id),
    createEdge(draft.id, approve.id),
    createEdge(approve.id, publish.id, {
      sourceHandle: 'approved',
      kind: 'conditional',
      label: 'approved',
    }),
    createEdge(publish.id, output.id),
  ];
  wf.limits.requireHumanApproval = true;
  wf.variables = [variable('message', 'Content to publish', 'Ship the weekly recap')];
  return wf;
}

export function createMultiAgentDebateTemplate(): Workflow {
  const wf = createEmptyWorkflow('Multi-Agent Debate');
  wf.description = 'Proposer and critic run in parallel, then a synthesizer merges them';
  wf.tags = ['template', 'multi-agent', 'autogen'];
  const input = createNode('input', templateAt(0), 'Topic');
  const propose = createNode('agent', templateAt(1), 'Proposer');
  propose.data.config = {
    ...propose.data.config,
    systemPrompt: 'Argue for a concrete proposal. Be concise.',
  };
  const critique = createNode('critic', templateAt(1, 1), 'Critic');
  const synthesize = createNode('agent', templateAt(2), 'Synthesizer');
  synthesize.data.config = {
    ...synthesize.data.config,
    systemPrompt: 'Merge the proposal and critique into a consensus answer.',
  };
  const output = createNode('output', templateAt(3), 'Consensus');
  wf.nodes = [input, propose, critique, synthesize, output];
  wf.edges = [
    createEdge(input.id, propose.id),
    createEdge(input.id, critique.id),
    createEdge(propose.id, synthesize.id),
    createEdge(critique.id, synthesize.id),
    createEdge(synthesize.id, output.id),
  ];
  wf.variables = [variable('message', 'Debate topic', 'Should agents own production deploys?')];
  return wf;
}

/** Yao et al. ReAct / LangChain AgentExecutor / Hugging Face smolagents */
export function createReactToolLoopTemplate(): Workflow {
  const wf = createEmptyWorkflow('ReAct Tool Loop');
  wf.description =
    'Reason → decide to search or finish → gated web search → observe → reason again';
  wf.tags = ['template', 'react', 'langchain', 'smolagents'];

  const start = createNode('input', templateAt(0), 'Task');
  const reason = extraPorts(createNode('agent', templateAt(1), 'Reason'), [
    port('action', 'Action'),
    port('query', 'Query'),
    port('finish', 'Finish'),
    port('search', 'Search'),
    port('payload', 'Payload'),
  ]);
  reason.data.config = {
    ...reason.data.config,
    systemPrompt:
      'Think about the task. If you need information, return action=search with a query. If you can answer, return action=finish.',
    maxIterations: 6,
    mockActions: ['search', 'finish'],
    model: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0 },
  };
  reason.data.configSummary = 'ReAct reason · mockActions search→finish';

  const decide = createNode('condition', templateAt(2), 'Finished?');
  decide.data.config = {
    expression: 'value.action == "finish"',
    trueLabel: 'finish',
    falseLabel: 'search',
  };

  const gate = createNode('schema_gate', templateAt(2, 1), 'Search Contract');
  gate.data.config = { ...gate.data.config, jsonSchema: SEARCH_SCHEMA, failClosed: true };

  const search = createNode('web_search', templateAt(3, 1), 'Web Search');
  search.data.config = { ...search.data.config, maxResults: 5 };

  const answer = createNode('summarizer', templateAt(3), 'Final Answer');
  const end = createNode('output', templateAt(4), 'Done');

  wf.nodes = [start, reason, decide, gate, search, answer, end];
  wf.edges = [
    createEdge(start.id, reason.id, { targetHandle: 'goal' }),
    createEdge(reason.id, decide.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'payload', targetPort: 'value' },
    }),
    createEdge(decide.id, answer.id, {
      kind: 'conditional',
      sourceHandle: 'true',
      label: 'finish',
    }),
    createEdge(decide.id, gate.id, {
      kind: 'conditional',
      sourceHandle: 'false',
      label: 'search',
      dataMapping: { sourcePort: 'payload', targetPort: 'value' },
    }),
    createEdge(gate.id, search.id, {
      kind: 'conditional',
      sourceHandle: 'pass',
      label: 'pass',
      dataMapping: { sourcePort: 'payload', targetPort: 'query' },
    }),
    createEdge(search.id, reason.id, {
      kind: 'data',
      targetHandle: 'context',
      dataMapping: { sourcePort: 'results', targetPort: 'context' },
    }),
    createEdge(answer.id, end.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'summary', targetPort: 'value' },
    }),
  ];
  wf.variables = [variable('message', 'Task for the ReAct loop', 'What is Agent Loop Builder?')];
  return wf;
}

/** Compact ReAct as a single node (smolagents / LangChain AgentExecutor inner loop) */
export function createReactAgentNodeTemplate(): Workflow {
  const wf = createEmptyWorkflow('ReAct Agent Node');
  wf.description = 'Single ReAct node that thinks, calls allowlisted tools, and finishes';
  wf.tags = ['template', 'react', 'smolagents'];
  const start = createNode('input', templateAt(0), 'Task');
  const agent = createNode('react_agent', templateAt(1), 'ReAct Agent');
  agent.data.config = {
    ...agent.data.config,
    tools: ['web_search'],
    mockToolSteps: 1,
    maxIterations: 6,
  };
  agent.data.configSummary = 'Inner Thought→Act→Observe loop';
  const end = createNode('output', templateAt(2), 'Answer');
  wf.nodes = [start, agent, end];
  wf.edges = [
    createEdge(start.id, agent.id, { targetHandle: 'task' }),
    createEdge(agent.id, end.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'result', targetPort: 'value' },
    }),
  ];
  wf.variables = [variable('message', 'Task', 'Summarize the ReAct paper in one sentence')];
  return wf;
}

/** LangChain Plan-and-Execute / HuggingGPT */
export function createPlanAndExecuteTemplate(): Workflow {
  const wf = createEmptyWorkflow('Plan and Execute');
  wf.description = 'Plan once, then an executor loop carries out the steps and a writer reports';
  wf.tags = ['template', 'plan-execute', 'langchain'];
  const start = createNode('input', templateAt(0), 'Goal');
  const planner = createNode('planner', templateAt(1), 'Planner');
  planner.data.config = {
    ...planner.data.config,
    systemPrompt: 'Break the goal into 2-4 concrete steps. Do not execute them.',
    maxSteps: 4,
  };
  const executor = createNode('react_agent', templateAt(2), 'Executor');
  executor.data.config = {
    ...executor.data.config,
    systemPrompt: 'Execute the plan step by step using allowlisted tools, then return results.',
    tools: ['web_search'],
    mockToolSteps: 1,
    maxIterations: 6,
  };
  const writer = createNode('summarizer', templateAt(3), 'Final Report');
  const end = createNode('output', templateAt(4), 'Done');
  wf.nodes = [start, planner, executor, writer, end];
  wf.edges = [
    createEdge(start.id, planner.id),
    createEdge(planner.id, executor.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'plan', targetPort: 'task' },
    }),
    createEdge(executor.id, writer.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'result', targetPort: 'content' },
    }),
    createEdge(writer.id, end.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'summary', targetPort: 'value' },
    }),
  ];
  wf.variables = [
    variable('message', 'Goal to plan and execute', 'Compare two agent orchestration styles'),
  ];
  return wf;
}

/** Reflexion (Shinn et al., 2023) */
export function createReflexionTemplate(): Workflow {
  const wf = createEmptyWorkflow('Reflexion');
  wf.description = 'Actor attempts, evaluator scores, critic reflects, actor retries';
  wf.tags = ['template', 'reflexion'];
  const start = createNode('input', templateAt(0), 'Task');
  const actor = createNode('agent', templateAt(1), 'Actor');
  actor.data.config = {
    ...actor.data.config,
    systemPrompt: 'Attempt the task. Use prior critique if present.',
    maxIterations: 6,
  };
  const evaluate = createNode('evaluator', templateAt(2), 'Self-Evaluate');
  evaluate.data.config = { ...evaluate.data.config, threshold: 0.7, mockFailUntil: 1 };
  const critic = createNode('critic', templateAt(1, 1), 'Reflection');
  critic.data.config = {
    ...critic.data.config,
    systemPrompt: 'Explain what failed and what to change on the next attempt.',
  };
  const answer = createNode('output', templateAt(3), 'Solution');
  wf.nodes = [start, actor, evaluate, critic, answer];
  wf.edges = [
    createEdge(start.id, actor.id),
    createEdge(actor.id, evaluate.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'result', targetPort: 'result' },
    }),
    createEdge(evaluate.id, critic.id, {
      kind: 'conditional',
      sourceHandle: 'insufficient',
      label: 'insufficient',
    }),
    createEdge(critic.id, actor.id, {
      kind: 'data',
      targetHandle: 'context',
      dataMapping: { sourcePort: 'critique', targetPort: 'context' },
    }),
    createEdge(evaluate.id, answer.id, {
      kind: 'conditional',
      sourceHandle: 'sufficient',
      label: 'sufficient',
    }),
  ];
  wf.variables = [variable('message', 'Task', 'Write a safer tool-calling policy')];
  return wf;
}

/** LlamaIndex / LangChain RAG retrieve-generate-refine */
export function createRagRefineTemplate(): Workflow {
  const wf = createEmptyWorkflow('RAG Refine Loop');
  wf.description = 'Retrieve, generate, evaluate; retrieve again if the answer is thin';
  wf.tags = ['template', 'rag', 'llamaindex'];
  const start = createNode('input', templateAt(0), 'Question');
  const gate = createNode('schema_gate', templateAt(1), 'Query Contract');
  gate.data.config = { ...gate.data.config, jsonSchema: QUERY_MESSAGE_SCHEMA, failClosed: true };
  const retrieve = createNode('web_search', templateAt(2), 'Retrieve');
  const generate = createNode('llm', templateAt(3), 'Generate');
  generate.data.config = {
    ...generate.data.config,
    systemPrompt: 'Answer using the retrieved snippets. Note remaining gaps.',
  };
  const evaluate = createNode('evaluator', templateAt(4), 'Grounded?');
  evaluate.data.config = { ...evaluate.data.config, threshold: 0.7, mockFailUntil: 1 };
  const end = createNode('output', templateAt(5), 'Answer');
  wf.nodes = [start, gate, retrieve, generate, evaluate, end];
  wf.edges = [
    createEdge(start.id, gate.id),
    createEdge(gate.id, retrieve.id, {
      kind: 'conditional',
      sourceHandle: 'pass',
      label: 'pass',
    }),
    createEdge(retrieve.id, generate.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'results', targetPort: 'prompt' },
    }),
    createEdge(generate.id, evaluate.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'completion', targetPort: 'result' },
    }),
    createEdge(evaluate.id, gate.id, {
      kind: 'conditional',
      sourceHandle: 'insufficient',
      label: 'insufficient',
    }),
    createEdge(evaluate.id, end.id, {
      kind: 'conditional',
      sourceHandle: 'sufficient',
      label: 'sufficient',
    }),
  ];
  wf.variables = [
    variable('message', 'Question', 'How do linked skill chains get packed?'),
  ];
  return wf;
}

/** LangGraph supervisor / OpenAI Swarm handoffs */
export function createSupervisorHandoffTemplate(): Workflow {
  const wf = createEmptyWorkflow('Supervisor Handoffs');
  wf.description = 'A router hands the task to one specialist, then returns a single answer';
  wf.tags = ['template', 'supervisor', 'swarm'];
  const start = createNode('input', templateAt(0), 'Request');
  const router = extraPorts(createNode('router', templateAt(1), 'Supervisor'), [
    port('research', 'Research'),
    port('support', 'Support'),
  ]);
  router.data.config = {
    ...router.data.config,
    routes: ['research', 'support'],
    mockRoute: 'research',
    systemPrompt: 'Hand off to research or support.',
  };
  router.data.configSummary = 'Routes: research | support';
  const research = createNode('agent', templateAt(2), 'Research Specialist');
  research.data.config = {
    ...research.data.config,
    systemPrompt: 'Answer with sourced analysis.',
  };
  const support = createNode('agent', templateAt(2, 1), 'Support Specialist');
  support.data.config = {
    ...support.data.config,
    systemPrompt: 'Answer as a support agent with next steps.',
  };
  const end = createNode('output', templateAt(3), 'Reply');
  wf.nodes = [start, router, research, support, end];
  wf.edges = [
    createEdge(start.id, router.id),
    createEdge(router.id, research.id, {
      kind: 'conditional',
      sourceHandle: 'research',
      label: 'research',
    }),
    createEdge(router.id, support.id, {
      kind: 'conditional',
      sourceHandle: 'support',
      label: 'support',
    }),
    createEdge(research.id, end.id),
    createEdge(support.id, end.id),
  ];
  wf.variables = [variable('message', 'Incoming request', 'Explain agent loops vs chains')];
  return wf;
}

const STRING_SCHEMA = `{ "type": "string" }`;

/** LangGraph CRAG: grade retrieved docs, fall back to web search when they are weak. */
export function createCorrectiveRagTemplate(): Workflow {
  const wf = createEmptyWorkflow('Corrective RAG');
  wf.description = 'Retrieve, grade relevance, and web-search when the corpus is insufficient';
  wf.tags = ['template', 'crag', 'langgraph'];
  const start = createNode('input', templateAt(0), 'Question');
  const gate = createNode('schema_gate', templateAt(1), 'Query Contract');
  gate.data.config = { ...gate.data.config, jsonSchema: QUERY_MESSAGE_SCHEMA, failClosed: true };
  const retrieve = createNode('web_search', templateAt(2), 'Retrieve Corpus');
  const grade = createNode('evaluator', templateAt(3), 'Grade Docs');
  grade.data.config = { ...grade.data.config, threshold: 0.7, mockFailUntil: 1 };
  const rewrite = createNode('llm', templateAt(3, 1), 'Rewrite Query');
  rewrite.data.config = {
    ...rewrite.data.config,
    systemPrompt: 'Rewrite the question so a web search can fill the knowledge gap.',
  };
  const webGate = createNode('schema_gate', templateAt(4, 1), 'Search Contract');
  webGate.data.config = { ...webGate.data.config, jsonSchema: STRING_SCHEMA, failClosed: true };
  const search = createNode('web_search', templateAt(5, 1), 'Web Search');
  const generateHit = createNode('llm', templateAt(4), 'Generate From Docs');
  const generateMiss = createNode('llm', templateAt(6, 1), 'Generate From Web');
  const end = createNode('output', templateAt(7), 'Answer');
  wf.nodes = [start, gate, retrieve, grade, rewrite, webGate, search, generateHit, generateMiss, end];
  wf.edges = [
    createEdge(start.id, gate.id),
    createEdge(gate.id, retrieve.id, { kind: 'conditional', sourceHandle: 'pass', label: 'pass' }),
    createEdge(retrieve.id, grade.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'results', targetPort: 'result' },
    }),
    createEdge(grade.id, generateHit.id, {
      kind: 'conditional',
      sourceHandle: 'sufficient',
      label: 'sufficient',
    }),
    createEdge(grade.id, rewrite.id, {
      kind: 'conditional',
      sourceHandle: 'insufficient',
      label: 'insufficient',
    }),
    createEdge(rewrite.id, webGate.id),
    createEdge(webGate.id, search.id, { kind: 'conditional', sourceHandle: 'pass', label: 'pass' }),
    createEdge(search.id, generateMiss.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'results', targetPort: 'prompt' },
    }),
    createEdge(generateHit.id, end.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'completion', targetPort: 'value' },
    }),
    createEdge(generateMiss.id, end.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'completion', targetPort: 'value' },
    }),
  ];
  wf.variables = [variable('message', 'Question', 'What is corrective RAG?')];
  return wf;
}

/** LangGraph Adaptive RAG: route to corpus, web, or a direct answer. */
export function createAdaptiveRagTemplate(): Workflow {
  const wf = createEmptyWorkflow('Adaptive RAG');
  wf.description = 'Route each question to vector retrieval, web search, or a direct LLM answer';
  wf.tags = ['template', 'adaptive-rag', 'langgraph'];
  const start = createNode('input', templateAt(0), 'Question');
  const router = extraPorts(createNode('classifier', templateAt(1), 'Route Question'), [
    port('retrieve', 'Retrieve'),
    port('web', 'Web'),
    port('direct', 'Direct'),
  ]);
  router.data.config = {
    ...router.data.config,
    labels: ['retrieve', 'web', 'direct'],
    mockLabel: 'web',
  };
  const retrieve = createNode('agent', templateAt(2), 'Vector Retrieve');
  retrieve.data.config = {
    ...retrieve.data.config,
    systemPrompt: 'Retrieve domain documents for the question.',
    tools: ['web_search'],
  };
  const search = createNode('agent', templateAt(2, 1), 'Web Search');
  search.data.config = {
    ...search.data.config,
    systemPrompt: 'Search the public web for an up-to-date answer.',
    tools: ['web_search'],
  };
  const generate = createNode('llm', templateAt(3), 'Generate');
  const direct = createNode('llm', templateAt(2, 2), 'Direct Answer');
  const end = createNode('output', templateAt(4), 'Answer');
  wf.nodes = [start, router, retrieve, search, generate, direct, end];
  wf.edges = [
    createEdge(start.id, router.id),
    createEdge(router.id, retrieve.id, {
      kind: 'conditional',
      sourceHandle: 'retrieve',
      label: 'retrieve',
    }),
    createEdge(retrieve.id, generate.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'result', targetPort: 'prompt' },
    }),
    createEdge(router.id, search.id, { kind: 'conditional', sourceHandle: 'web', label: 'web' }),
    createEdge(search.id, generate.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'result', targetPort: 'prompt' },
    }),
    createEdge(router.id, direct.id, { kind: 'conditional', sourceHandle: 'direct', label: 'direct' }),
    createEdge(generate.id, end.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'completion', targetPort: 'value' },
    }),
    createEdge(direct.id, end.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'completion', targetPort: 'value' },
    }),
  ];
  wf.variables = [variable('message', 'Question', 'Who maintains LangGraph?')];
  return wf;
}

/** LangChain SQL agent: generate SQL, execute, repair from the error. */
export function createSqlRepairTemplate(): Workflow {
  const wf = createEmptyWorkflow('SQL Repair Loop');
  wf.description = 'Generate SQL, execute it, and loop the error back into the writer';
  wf.tags = ['template', 'sql', 'langchain'];
  const start = createNode('input', templateAt(0), 'Ask');
  const writer = createNode('llm', templateAt(1), 'Write SQL');
  writer.data.config = {
    ...writer.data.config,
    systemPrompt: 'Write a single SQL query. If an error is present, fix the previous query.',
  };
  const gate = createNode('schema_gate', templateAt(2), 'SQL Contract');
  gate.data.config = { ...gate.data.config, jsonSchema: STRING_SCHEMA, failClosed: true };
  const exec = createNode('database', templateAt(3), 'Execute SQL');
  exec.data.config = { ...exec.data.config, mockFailUntil: 1 };
  const end = createNode('output', templateAt(4), 'Rows');
  wf.nodes = [start, writer, gate, exec, end];
  wf.edges = [
    createEdge(start.id, writer.id),
    createEdge(writer.id, gate.id),
    createEdge(gate.id, exec.id, { kind: 'conditional', sourceHandle: 'pass', label: 'pass' }),
    createEdge(exec.id, end.id, { kind: 'conditional', sourceHandle: 'success', label: 'success' }),
    createEdge(exec.id, writer.id, {
      kind: 'conditional',
      sourceHandle: 'fail',
      label: 'fail',
      dataMapping: { sourcePort: 'reason', targetPort: 'prompt' },
    }),
  ];
  wf.variables = [variable('message', 'Question', 'How many open loops are in the workspace?')];
  return wf;
}

/** Anthropic Constitutional AI: draft, critique against a constitution, revise. */
export function createConstitutionalAiTemplate(): Workflow {
  const wf = createEmptyWorkflow('Constitutional AI');
  wf.description = 'Draft an answer, critique it against a constitution, and revise until it passes';
  wf.tags = ['template', 'constitutional', 'anthropic'];
  const start = createNode('input', templateAt(0), 'Prompt');
  const draft = createNode('llm', templateAt(1), 'Draft');
  const critic = createNode('critic', templateAt(2), 'Constitution');
  critic.data.config = {
    ...critic.data.config,
    systemPrompt: 'Critique the draft against: be truthful, refuse harm, and cite uncertainty.',
  };
  const grade = createNode('evaluator', templateAt(3), 'Aligned?');
  grade.data.config = { ...grade.data.config, threshold: 0.7, mockFailUntil: 1 };
  const revise = createNode('llm', templateAt(2, 1), 'Revise');
  revise.data.config = {
    ...revise.data.config,
    systemPrompt: 'Rewrite the draft to address the constitution critique.',
  };
  const end = createNode('output', templateAt(4), 'Answer');
  wf.nodes = [start, draft, critic, grade, revise, end];
  wf.edges = [
    createEdge(start.id, draft.id),
    createEdge(draft.id, critic.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'completion', targetPort: 'content' },
    }),
    createEdge(critic.id, grade.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'critique', targetPort: 'result' },
    }),
    createEdge(grade.id, end.id, { kind: 'conditional', sourceHandle: 'sufficient', label: 'sufficient' }),
    createEdge(grade.id, revise.id, { kind: 'conditional', sourceHandle: 'insufficient', label: 'insufficient' }),
    createEdge(revise.id, draft.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'completion', targetPort: 'prompt' },
    }),
  ];
  wf.variables = [variable('message', 'Prompt', 'Explain how to evaluate an agent loop safely')];
  return wf;
}

/** CAMEL role-playing: two agents converse until a task-complete evaluator fires. */
export function createCamelRoleplayTemplate(): Workflow {
  const wf = createEmptyWorkflow('CAMEL Role-Play');
  wf.description = 'User-proxy and assistant agents talk until the task is marked complete';
  wf.tags = ['template', 'camel', 'roleplay'];
  const start = createNode('input', templateAt(0), 'Task');
  const user = createNode('agent', templateAt(1), 'User Proxy');
  user.data.config = {
    ...user.data.config,
    systemPrompt: 'You are the user proxy. Instruct the assistant toward the task. Say TASK_DONE when satisfied.',
  };
  const assistant = createNode('agent', templateAt(2), 'Assistant');
  assistant.data.config = {
    ...assistant.data.config,
    systemPrompt: 'You are the assistant. Follow the user-proxy instructions and solve the task.',
  };
  const done = createNode('evaluator', templateAt(3), 'Task Complete?');
  done.data.config = { ...done.data.config, threshold: 0.7, mockFailUntil: 1 };
  const end = createNode('output', templateAt(4), 'Solution');
  wf.nodes = [start, user, assistant, done, end];
  wf.edges = [
    createEdge(start.id, user.id),
    createEdge(user.id, assistant.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'result', targetPort: 'goal' },
    }),
    createEdge(assistant.id, done.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'result', targetPort: 'result' },
    }),
    createEdge(done.id, end.id, { kind: 'conditional', sourceHandle: 'sufficient', label: 'sufficient' }),
    createEdge(done.id, user.id, { kind: 'conditional', sourceHandle: 'insufficient', label: 'insufficient' }),
  ];
  wf.variables = [variable('message', 'Task', 'Write a one-sentence skill-chain definition')];
  return wf;
}

/** Magentic-One: orchestrator ledger loop over WebSurfer / Coder / FileSurfer. */
export function createMagenticOneTemplate(): Workflow {
  const wf = createEmptyWorkflow('Magentic-One');
  wf.description = 'An orchestrator assigns work to web, code, and file specialists until the ledger is satisfied';
  wf.tags = ['template', 'magentic-one', 'autogen'];
  const start = createNode('input', templateAt(0), 'Task');
  const orch = extraPorts(createNode('router', templateAt(1), 'Orchestrator'), [
    port('web', 'Web'),
    port('coder', 'Coder'),
    port('file', 'File'),
  ]);
  orch.data.config = {
    ...orch.data.config,
    routes: ['web', 'coder', 'file'],
    mockRoute: 'web',
    systemPrompt: 'Assign the next ledger item to web, coder, or file.',
  };
  const web = createNode('agent', templateAt(2), 'WebSurfer');
  web.data.config = {
    ...web.data.config,
    systemPrompt: 'Browse and summarize findings for the orchestrator.',
    tools: ['web_search'],
  };
  const coder = createNode('agent', templateAt(2, 1), 'Coder');
  coder.data.config = {
    ...coder.data.config,
    systemPrompt: 'Propose code or analysis for the current ledger item.',
  };
  const files = createNode('agent', templateAt(2, 2), 'FileSurfer');
  files.data.config = {
    ...files.data.config,
    systemPrompt: 'Inspect workspace files relevant to the task.',
  };
  const ledger = createNode('evaluator', templateAt(3), 'Ledger');
  ledger.data.config = { ...ledger.data.config, threshold: 0.7, mockFailUntil: 1 };
  const end = createNode('output', templateAt(4), 'Done');
  wf.nodes = [start, orch, web, coder, files, ledger, end];
  wf.edges = [
    createEdge(start.id, orch.id),
    createEdge(orch.id, web.id, { kind: 'conditional', sourceHandle: 'web', label: 'web' }),
    createEdge(orch.id, coder.id, { kind: 'conditional', sourceHandle: 'coder', label: 'coder' }),
    createEdge(orch.id, files.id, { kind: 'conditional', sourceHandle: 'file', label: 'file' }),
    createEdge(web.id, ledger.id),
    createEdge(coder.id, ledger.id),
    createEdge(files.id, ledger.id),
    createEdge(ledger.id, end.id, { kind: 'conditional', sourceHandle: 'sufficient', label: 'sufficient' }),
    createEdge(ledger.id, orch.id, { kind: 'conditional', sourceHandle: 'insufficient', label: 'insufficient' }),
  ];
  wf.variables = [variable('message', 'Task', 'Find how Agent Loop Builder executes cycles')];
  return wf;
}

/** BabyAGI: create a task, execute it, reprioritize, repeat. */
export function createBabyAgiTemplate(): Workflow {
  const wf = createEmptyWorkflow('BabyAGI Task List');
  wf.description = 'Create a task, execute it, then reprioritize until the task list is empty';
  wf.tags = ['template', 'babyagi', 'autonomous'];
  const start = createNode('input', templateAt(0), 'Objective');
  const creator = createNode('planner', templateAt(1), 'Task Creator');
  creator.data.config = {
    ...creator.data.config,
    systemPrompt: 'Maintain a short task list for the objective. Drop completed work.',
  };
  const executor = createNode('react_agent', templateAt(2), 'Task Executor');
  executor.data.config = {
    ...executor.data.config,
    systemPrompt: 'Execute the next task on the list.',
    tools: ['web_search'],
    mockToolSteps: 1,
    maxIterations: 4,
  };
  const prior = createNode('planner', templateAt(3), 'Prioritizer');
  prior.data.config = {
    ...prior.data.config,
    systemPrompt: 'Reprioritize remaining tasks given the latest result.',
  };
  const empty = createNode('evaluator', templateAt(4), 'List Empty?');
  empty.data.config = { ...empty.data.config, threshold: 0.7, mockFailUntil: 1 };
  const end = createNode('output', templateAt(5), 'Result');
  wf.nodes = [start, creator, executor, prior, empty, end];
  wf.edges = [
    createEdge(start.id, creator.id),
    createEdge(creator.id, executor.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'plan', targetPort: 'task' },
    }),
    createEdge(executor.id, prior.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'result', targetPort: 'goal' },
    }),
    createEdge(prior.id, empty.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'plan', targetPort: 'result' },
    }),
    createEdge(empty.id, end.id, { kind: 'conditional', sourceHandle: 'sufficient', label: 'sufficient' }),
    createEdge(empty.id, creator.id, { kind: 'conditional', sourceHandle: 'insufficient', label: 'insufficient' }),
  ];
  wf.variables = [variable('message', 'Objective', 'Build a reusable research skill')];
  return wf;
}

/** Tree of Thoughts: expand candidate thoughts in parallel, keep the best, repeat. */
export function createTreeOfThoughtsTemplate(): Workflow {
  const wf = createEmptyWorkflow('Tree of Thoughts');
  wf.description = 'Expand two candidate thoughts, evaluate, and loop until a solution is found';
  wf.tags = ['template', 'tot', 'search'];
  const start = createNode('input', templateAt(0), 'Puzzle');
  const left = createNode('llm', templateAt(1), 'Thought A');
  left.data.config = {
    ...left.data.config,
    systemPrompt: 'Propose one concrete next thought toward solving the puzzle.',
  };
  const right = createNode('llm', templateAt(1, 1), 'Thought B');
  right.data.config = {
    ...right.data.config,
    systemPrompt: 'Propose an alternative next thought toward solving the puzzle.',
  };
  const merge = createNode('merge', templateAt(2), 'Collect Thoughts');
  const grade = createNode('evaluator', templateAt(3), 'Best Path?');
  grade.data.config = { ...grade.data.config, threshold: 0.7, mockFailUntil: 1 };
  const end = createNode('output', templateAt(4), 'Solution');
  wf.nodes = [start, left, right, merge, grade, end];
  wf.edges = [
    createEdge(start.id, left.id),
    createEdge(start.id, right.id),
    createEdge(left.id, merge.id, { targetHandle: 'a' }),
    createEdge(right.id, merge.id, { targetHandle: 'b' }),
    createEdge(merge.id, grade.id, {
      kind: 'data',
      dataMapping: { sourcePort: 'merged', targetPort: 'result' },
    }),
    createEdge(grade.id, end.id, { kind: 'conditional', sourceHandle: 'sufficient', label: 'sufficient' }),
    createEdge(grade.id, left.id, { kind: 'conditional', sourceHandle: 'insufficient', label: 'insufficient' }),
    createEdge(grade.id, right.id, { kind: 'conditional', sourceHandle: 'insufficient', label: 'insufficient' }),
  ];
  wf.variables = [variable('message', 'Puzzle', 'Plan a 3-step agent loop that cannot run forever')];
  return wf;
}

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: 'research-agent',
    name: 'Research Agent',
    description: 'Iterative research with evaluation loop and report generation',
    source: {
      pattern: 'Evaluate-and-retry graph',
      inspiredBy: 'LangGraph cyclic agents',
      url: 'https://github.com/langchain-ai/langgraph',
    },
    create: createResearchAgentTemplate,
  },
  {
    id: 'react-tool-loop',
    name: 'ReAct Tool Loop',
    description: 'Graph ReAct: reason, gated search, observe, repeat',
    source: {
      pattern: 'ReAct (Yao et al., 2022)',
      inspiredBy: 'LangChain AgentExecutor, Hugging Face smolagents',
      url: 'https://github.com/langchain-ai/langchain',
    },
    create: createReactToolLoopTemplate,
  },
  {
    id: 'react-agent-node',
    name: 'ReAct Agent Node',
    description: 'Single-node Thought → Act → Observe inner loop',
    source: {
      pattern: 'ReAct inner loop',
      inspiredBy: 'Hugging Face smolagents, LangChain create_agent',
      url: 'https://github.com/huggingface/smolagents',
    },
    create: createReactAgentNodeTemplate,
  },
  {
    id: 'plan-and-execute',
    name: 'Plan and Execute',
    description: 'Planner produces steps, executor loop carries them out',
    source: {
      pattern: 'Plan-and-Execute',
      inspiredBy: 'LangChain Plan-and-Execute, HuggingGPT',
      url: 'https://github.com/langchain-ai/langchain',
    },
    create: createPlanAndExecuteTemplate,
  },
  {
    id: 'reflexion',
    name: 'Reflexion',
    description: 'Actor, evaluator, and verbal self-reflection retry',
    source: {
      pattern: 'Reflexion (Shinn et al., 2023)',
      inspiredBy: 'noahshinn/reflexion',
      url: 'https://github.com/noahshinn/reflexion',
    },
    create: createReflexionTemplate,
  },
  {
    id: 'rag-refine',
    name: 'RAG Refine Loop',
    description: 'Retrieve → generate → evaluate, retrieve again if needed',
    source: {
      pattern: 'RAG refine / retry',
      inspiredBy: 'LlamaIndex, LangChain RAG',
      url: 'https://github.com/run-llama/llama_index',
    },
    create: createRagRefineTemplate,
  },
  {
    id: 'supervisor-handoffs',
    name: 'Supervisor Handoffs',
    description: 'Router hands off to one specialist agent',
    source: {
      pattern: 'Supervisor / handoffs',
      inspiredBy: 'LangGraph supervisor, OpenAI Swarm / Agents SDK',
      url: 'https://github.com/langchain-ai/langgraph',
    },
    create: createSupervisorHandoffTemplate,
  },
  {
    id: 'customer-support',
    name: 'Customer Support Agent',
    description: 'Classify, look up, and respond in a sequential crew',
    source: {
      pattern: 'Sequential crew',
      inspiredBy: 'CrewAI sequential process',
      url: 'https://github.com/crewAIInc/crewAI',
    },
    create: createCustomerSupportTemplate,
  },
  {
    id: 'human-in-the-loop',
    name: 'Human-in-the-Loop Approval',
    description: 'Draft, approve, then publish with human gate',
    source: {
      pattern: 'Interrupt / HITL',
      inspiredBy: 'LangGraph human-in-the-loop interrupts',
      url: 'https://github.com/langchain-ai/langgraph',
    },
    create: createHitlApprovalTemplate,
  },
  {
    id: 'multi-agent-debate',
    name: 'Multi-Agent Debate',
    description: 'Proposer, critic, and synthesizer agents',
    source: {
      pattern: 'Multi-agent debate',
      inspiredBy: 'AutoGen conversational agents',
      url: 'https://github.com/microsoft/autogen',
    },
    create: createMultiAgentDebateTemplate,
  },
  {
    id: 'corrective-rag',
    name: 'Corrective RAG',
    description: 'Grade retrieved docs and web-search when they are weak',
    source: {
      pattern: 'CRAG (Corrective RAG)',
      inspiredBy: 'LangGraph CRAG, Yan et al. 2024',
      url: 'https://github.com/langchain-ai/langgraph',
    },
    create: createCorrectiveRagTemplate,
  },
  {
    id: 'adaptive-rag',
    name: 'Adaptive RAG',
    description: 'Route a question to retrieval, web search, or a direct answer',
    source: {
      pattern: 'Adaptive RAG',
      inspiredBy: 'LangGraph Adaptive RAG',
      url: 'https://github.com/langchain-ai/langgraph',
    },
    create: createAdaptiveRagTemplate,
  },
  {
    id: 'sql-repair',
    name: 'SQL Repair Loop',
    description: 'Generate SQL, execute, and repair from the database error',
    source: {
      pattern: 'Generate-execute-repair',
      inspiredBy: 'LangChain SQL agent',
      url: 'https://github.com/langchain-ai/langchain',
    },
    create: createSqlRepairTemplate,
  },
  {
    id: 'constitutional-ai',
    name: 'Constitutional AI',
    description: 'Critique a draft against a constitution and revise',
    source: {
      pattern: 'Constitutional revision loop',
      inspiredBy: 'Anthropic Constitutional AI',
      url: 'https://github.com/anthropics/ConstitutionalHarmlessnessPaper',
    },
    create: createConstitutionalAiTemplate,
  },
  {
    id: 'camel-roleplay',
    name: 'CAMEL Role-Play',
    description: 'User-proxy and assistant converse until the task is done',
    source: {
      pattern: 'Role-playing conversation loop',
      inspiredBy: 'CAMEL (camel-ai/camel)',
      url: 'https://github.com/camel-ai/camel',
    },
    create: createCamelRoleplayTemplate,
  },
  {
    id: 'magentic-one',
    name: 'Magentic-One',
    description: 'Orchestrator ledger loop over web, code, and file specialists',
    source: {
      pattern: 'Magentic-One orchestrator',
      inspiredBy: 'Microsoft Magentic-One / AutoGen',
      url: 'https://github.com/microsoft/autogen',
    },
    create: createMagenticOneTemplate,
  },
  {
    id: 'babyagi-task-list',
    name: 'BabyAGI Task List',
    description: 'Create, execute, and reprioritize tasks until the list is empty',
    source: {
      pattern: 'Autonomous task list',
      inspiredBy: 'BabyAGI (yoheinakajima/babyagi)',
      url: 'https://github.com/yoheinakajima/babyagi',
    },
    create: createBabyAgiTemplate,
  },
  {
    id: 'tree-of-thoughts',
    name: 'Tree of Thoughts',
    description: 'Expand candidate thoughts in parallel and keep searching',
    source: {
      pattern: 'Tree of Thoughts (Yao et al., 2023)',
      inspiredBy: 'princeton-nlp/tree-of-thought-llm',
      url: 'https://github.com/princeton-nlp/tree-of-thought-llm',
    },
    create: createTreeOfThoughtsTemplate,
  },
];
