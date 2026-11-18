# Speaker notes · Agents Don’t Need More Tools. They Need Architecture.

_Generated from deck/slides.mjs. Edit there._

## 1 · Title  _(0:00)_

Hi, I'm Melanie Bauer from software architects. This talk is about the moment after the agent prototype works, when someone asks: can we put this into production?
I'll follow four problems that every prototype runs into, and for each one we look at the architecture that answers it. Then: how do you know it works, and how do you debug it? You'll see it live along the way, in two examples.
Let's start where most of us start.

## 2 · The prototype  _(0:40)_

Raise your hand if you've written something like this. [wait] Me too.
One agent. A prompt that says it's an expert in everything. And every tool we could find, here 24, from reading a log line to deleting customer data.
And then this line: "be careful with destructive actions". That doesn't stop anything. It's a wish.
And the uncomfortable part: this prototype works.

## 3 · It works in the demo  _(1:30)_

In the demo it works. Modern models are good. It finds the bug and fixes it.
It stops working when one of these four things arrives. You need several specialists with different data and permissions. Tasks run longer than one chat turn. Tools become risky. And users want to intervene. In production, all four arrive.
None of these is a prompt problem. They're architecture problems. So they are our route today: one chapter per problem, and at the end the question how you know it works.

## 4 · The question  _(2:15)_

The first problem, several specialists, comes with the question from the title of this session.
Where does collaboration between agents really help, and where are we building a slow, expensive prompt conference? A prompt conference is four agents in a room: same model, same tools, same data, different hats. It looks like teamwork and it costs like teamwork, but most of it is theatre.
I'll give you my answer at the end. To get there, we need three basics.

## 5 · What an agent is  _(2:45)_

Basic one: what an agent is. An agent is a loop. Follow the line clockwise.
A task comes in. One: the model looks at the task and everything it knows so far and picks the next step, usually a tool call. Two: code runs that tool. The model never touches anything itself. Three: the result goes back into the context. Four: before the next round, the budget is checked: steps, tokens, time. If there's budget left, the model picks again. When the model is done, the answer leaves the loop at the top.
Two things matter for everything that follows. The model decides, but code executes: that's where we'll put our boundaries. And a loop without a budget isn't autonomy. It's a bill.
So who decides what happens next, the model or you?

## 6 · The control ladder  _(3:30)_

That's basic two, the control ladder. The question is always: who decides the next step?
Code: you decide. A workflow: a graph decides, with steps, branches and pauses. A single agent: the model picks tools. Centralized: a supervisor agent picks other agents. Decentralized: peers pick each other, nobody is in charge.
Each station to the right buys flexibility, and you pay with predictability, testability and debugging time. So climb only for the parts of your problem where the path is really unknown. Usually that's a small part.
And as soon as an agent talks to anything outside its loop, it needs a wire.

## 7 · Three wires  _(4:15)_

Basic three: the wires. An agent connects to three kinds of things, and each connection now has an open protocol.
MCP, the Model Context Protocol, connects an agent to tools and data. Anthropic published it at the end of 2024.
A2A, the Agent2Agent protocol, connects an agent to another agent it does not control. Google started it in April 2025, it's now a Linux Foundation project, and version 1.0 is out.
AG-UI, the Agent User Interaction protocol, connects the agent system to the user interface: streaming text, tool calls, state and approvals. It comes from CopilotKit.
We'll meet A2A in chapter one, MCP in chapter three and AG-UI in chapter four. MCP stays on the slides: my demos use local tools, because what matters is which agent gets which tool, not the wire. If you're on .NET: Microsoft Agent Framework supports all three.
That's enough basics. Chapter one.

## 8 · Chapter: Several specialists  _(4:50)_

Chapter one: several specialists. When is a second agent worth it, and which shape should a team of agents have?
To make it concrete, I'll use an agent system that plans a developer conference. Seven areas with their own data: program, venue, catering, travel, budget, marketing and accessibility. You'll see it live at the end. For chapters two to four there's a second example, an incident desk, and I'll show it right where it fits.
But before we build a team, let's see how far one agent gets.

## 9 · Single-agent architectures  _(5:05)_

There's more than one way to build with a single agent.
A workflow with LLM steps: code decides the path, and the model fills in single steps, like classify this or extract that.
An agent with tools: the loop from before. The model picks the next tool.
An agent with skills: still one loop, but the prompt only lists the skills by name and description. When the agent needs one, it loads the full instructions with a tool. In Mastra you pass skills to the agent and it gets tools to load and read them. That keeps the context small even with many capabilities.
So which one fits when?

## 10 · Single agent: when each fits  _(5:35)_

The workflow fits known paths: extraction, triage, approvals. Predictable, testable, cheap. It gets stuck when the path is really unknown.
The agent with tools fits one domain where you don't know the path in advance. It gets worse with many tools and unrelated domains.
The agent with skills fits many capabilities with one owner. The limit: it's still one identity with one set of permissions. The skill that reads untrusted input runs with the same rights as the skill that writes.
So start here, and stay here as long as one agent passes your evals. Every extra agent costs tokens, latency and debugging time. Different tools or different topics alone are no reason to split.
If that decision reminds you of something, it should.

## 11 · Monolith or microservices  _(6:10)_

You already know this decision. A single agent is a monolith: all tools, all data, one context. A network of agents is microservices. And the rule we learned there applies here too: monolith first. Split when there's a reason, along a boundary, and the reasons are almost the same as for services. Different data, that's a bounded context. Different permissions, a different model, a different clock.
The costs are the same too: network hops, distributed debugging, data that's out of date. And one thing is worse than with microservices: every hop is a model call, slower, more expensive and not deterministic. And the contract between agents is plain language, so every handoff is a translation. A network without a real reason to split is a distributed monolith. With agents, we call that a prompt conference.
So here are the reasons to split.

## 12 · The four C’s  _(6:55)_

When one agent no longer passes your evals, because the context gets too big, the permissions clash or the costs explode, you split, and then along one of these four lines. It's my rule, not a law of nature, but it has held up well for me.
Context: they need different data, or simply less. In our conference, travel sees passports, and nobody else should. Capabilities: they may do different things. The agent that reads untrusted input should not hold the delete button. Cost: they need a different model. Clock: they run in parallel, or for hours. Waiting for a human is no reason for a second agent, though. That's a workflow that pauses, chapter two.
And one reason that isn't technical: who owns it. If another team builds its agent in Python and you build yours in C#, with their own releases and their own on-call, then those are two agents. You connect them over A2A, you don't merge their prompts. Conway's law applies to agents too.
So say you have a real reason to split. Which shape should the team have?

## 13 · Multi-agent architectures  _(7:50)_

These are the shapes you'll meet.
Centralized: one supervisor delegates to specialists. You'll also hear orchestrator. Hierarchical: supervisors of supervisors. Decentralized: peers talk to each other directly, handoffs, swarms. Blackboard: peers read and write one shared artefact. Council: everyone answers the same question and one step combines the answers.
The two you'll meet most are centralized and decentralized. Let's look at those properly, starting with centralized.

## 14 · Centralized  _(8:20)_

Centralized, with our conference team. One supervisor splits the request, delegates to the specialists and merges the answers. In Mastra that's an agent with an agents property. In the demo the supervisor is called triage.
The specialists never talk to each other. Everything goes through the supervisor.
What does that buy you, and what does it cost?

## 15 · Centralized: strengths and weaknesses  _(8:50)_

Centralized is good for one team that owns one answer.
Strengths: policies, budgets and the final answer live in one place, the supervisor can ask specialists in parallel, and the trace is one tree.
Weaknesses: the supervisor is a bottleneck. When accessibility finds a problem with a room, the supervisor has to relay it to venue, and it can retell it wrong. If it misunderstands something, everything after it is wrong.
So what happens if we take the supervisor away?

## 16 · Decentralized  _(9:25)_

Then you get decentralized. No supervisor. Each peer decides itself whom to ask. Venue asks accessibility directly, catering asks budget directly. In LangGraph that's a swarm, elsewhere handoffs or peer to peer.
And ownership can move: in a handoff, the next agent takes over the conversation.

## 17 · Decentralized: strengths and weaknesses  _(9:55)_

Decentralized is good for work where each step decides who is next, so no single agent can plan it up front.
Strengths: no bottleneck, the expert answers directly, ownership can move.
Weaknesses: who stops it? Who owns the final answer? Agents can ping-pong forever, and debugging a conversation nobody planned is hard.
So it needs hard limits in code: maximum depth and maximum messages per request. In the demo that's three levels and twelve messages.
Before the other shapes, one distinction that decides a lot.

## 18 · Agent as a tool or handoff  _(10:30)_

Between centralized and decentralized there's one question that decides a lot: after the call, who owns the answer?
Agent as a tool: the caller calls another agent like any other tool and gets a result back. It stays in charge, and it answers the user. That's what a supervisor does. In Mastra you give an agent other agents, in Microsoft Agent Framework you turn an agent into a function, and a remote A2A agent can be a tool just as well.
Handoff: the agent passes the conversation on. From now on the next agent talks to the user. That's decentralized.
Rule of thumb: if you need one place for policy and the final answer, use agents as tools. Hand off only when the next agent should really own the conversation, like a support desk passing you on to billing.
Three more shapes, briefly.

## 19 · Three more shapes  _(11:20)_

Hierarchical: centralized, repeated, teams with their own leads. Every level adds latency.
Blackboard: peers write one shared artefact, like our conference plan. Watch for stale reads, you'll see one in the demo.
Council: several answer, one combines. It only helps if the members really differ. Which brings us to the prompt conference.

## 20 · Council or prompt conference  _(11:50)_

Both boxes have the same shape: four members answer the same question, one step combines.
On the left, a real council: different models, or members that look at different data. Their answers can disagree, and that's how they catch each other's mistakes.
On the right, the prompt conference: SRE, security, performance, product. Four personas, same model, same tools, same data. They agree because they're the same, not because they checked.
Research on debate agrees: a 2025 study by Zhang and colleagues tested five debate methods on nine benchmarks. Debate often did not beat simply asking once with reasoning, or asking several times and voting. What did help: members built on different models.
Before the evidence, a quick look at the wire that connects agents across teams and companies: A2A.

## 21 · How A2A works  _(12:20)_

How does that work in practice? Three steps.
Discovery: every A2A agent publishes an agent card, by default at a well-known URL, slash well-known slash agent-card.json. It says who the agent is, which skills it has, with descriptions and examples, which endpoints and protocol bindings it speaks, JSON-RPC, gRPC or plain HTTP, whether it streams, and how you authenticate. You can also get cards from a registry or simply configure them. The description in the card is what a supervisor reads to decide whom to call. So the card is your API documentation, written for a model.
Then you send a message. The agent can answer right away, or it creates a task with an id and a lifecycle: working, then completed, failed, canceled or rejected. Or interrupted: input required, or auth required. That's the A2A version of pause: the remote agent needs something before it can go on.
Results come back as artifacts, documents or structured data. You stream them with server-sent events, get a webhook, or poll.
What you never see: its tools, its prompt, its memory. The venue company runs its agent with its own model and its own data, and you only see the contract. Version 1.0 has been out since April, and Microsoft Agent Framework and Mastra both host and call A2A agents.

## 22 · A2A works with every topology  _(13:10)_

And one misunderstanding: A2A means decentralized? It doesn't. A2A is a wire, and it works with every topology.
On the left, remote A2A agents are simply tools of the supervisor, maybe run by the venue and the caterer. On the right, peers call each other over A2A. Who owns the answer and who owns the agents are two separate questions.
One tip from the demo: check what your card publishes. In my Mastra version it contained the agent's full instructions.
So much for shapes. Does any of this pay off?

## 23 · What the evidence says  _(13:35)_

The biggest study is from Google Research, MIT and others, updated this April: 260 configurations, six agent benchmarks, one single agent against four team architectures, with models from OpenAI, Google and Anthropic.
On a task that splits into parallel parts, financial analysis, a centralized team was 81 % better than one agent. On a task where each step depends on the one before, planning in a game world, every team variant was worse, by up to 70 %. And once one agent already reaches about 45 % accuracy, more agents tend to hurt. And errors grow: without a supervisor that checks, up to 17 times; with one, about 4 times.
Stanford, April: give one agent and a team the same thinking budget, and the single agent is as good or better on multi-hop questions. A lot of what we credit to teams is just more compute.
Anthropic, January: start with one agent. Teams help with polluted context, parallel work and specialisation, and cost three to ten times the tokens.
That's the four C's again. And it's why my default is one agent until it fails your evals.

## 24 · Which architecture when?  _(14:35)_

So how do you choose? Read it like a line map, left to right.
Is the path known? Then a workflow, with LLM steps where you need language understanding.
Does one agent pass your evals? Then a single agent, the cheapest option. If it has many tools, give it skills before you give it colleagues.
If not, split along the four C's. Is there one owner of the answer? Then centralized, hierarchical if it gets large. If no single agent can own the answer, because each step decides who works next: do the agents talk, or build one artefact? Talk: decentralized, with limits. Artefact: blackboard.
A council can be added at any station when you need independent judgement, but only with different models or different evidence.
That's chapter one. But even the best shape breaks when a task takes longer than one conversation.

## 25 · Chapter: Tasks run longer  _(15:25)_

Chapter two: tasks run longer. An outage where the fix waits for someone to approve it. A conference plan that grows over weeks. A chat loop can't do that, and it shouldn't try.

## 26 · Put a workflow around the agent  _(15:40)_

The first answer: put a workflow around the agent. This is the incident desk you'll see in a minute: checkout returns errors, a ticket comes in.
Loading the ticket is code, and it already removes the customer's name, e-mail and card. Classifying the severity is one LLM step with a small model. A low severity ticket takes the other branch: a backlog item, done. Only the investigation is open, so that's where the agent works, with two read-only specialists. Then a person approves, and plain code executes, against an allow list.
That's the control ladder applied: each step only as flexible as it needs to be. And a workflow can do something a chat loop can't: wait.

## 27 · Pause and resume  _(16:20)_

On Monday the investigation is done and the workflow reaches the approval. It stops and writes a snapshot of its state into the database. The process can restart, you can deploy a new version. On Wednesday a person approves, the workflow loads the snapshot and continues where it stopped.
In Mastra that's suspend and resume, with the snapshot in the storage you configure. In Microsoft Agent Framework it's request ports and checkpoints. Durable state is what makes long tasks robust.
Let me show you that live.
[DEMO Desk 1, 2 minutes: Visualization steps 1 to 4, Workflow tab Run INC-4711 until the approval card, Approve, Studio graph. Then slide 28.]

## 28 · Memory  _(19:00)_

Back to the slides. The workflow keeps the state of one run. But over weeks, an agent also has to remember things. Most frameworks offer the same four kinds of memory. These are Mastra's.
Message history: the last messages of the current conversation, per thread. Working memory: structured facts and decisions, like "the budget cap is 180,000" or "Room C is out", kept per user or per project across conversations. Semantic recall: older messages found by meaning. And compression: older messages condensed into notes so the context stays small. Mastra calls that observational memory.
The important part for architecture: everything you remember ends up in the context of some model call. So memory is a Context decision, and a privacy decision.
And in a network that raises a question: who may remember what?

## 29 · Memory in a network  _(19:50)_

In Mastra, every delegation starts the specialist with a new, empty thread, and only the prompt and the answer are saved. That's a good default. But careful: by default the specialist also gets the supervisor's conversation as context. If you don't want that, you filter it. That's what the message filter in chapter three is for.
Save results, not transcripts: decisions and structured findings go into working memory, not the whole chat.
Shared memory is shared state, with the same risks as a blackboard.
And personal data stays where it's needed. If the travel agent remembers passport numbers, they must not end up in the budget agent's context.
Memory decides what an agent knows. Chapter three is about what it can do.

## 30 · Chapter: Tools become risky  _(20:30)_

Chapter three: tools become risky. A prompt can ask an agent to be careful. Only the architecture can make sure.
We start with the simplest boundary.

## 31 · Each agent gets only its tools  _(20:45)_

Each agent gets only its own tools. Venue can list, assign and drop rooms. Travel reads passports and books travel. Budget reads the budget and checks the plan. Nobody else holds those tools, so nobody else sees a passport number.
That includes MCP. An MCP server often brings forty tools. Don't hand the whole server to every agent. Filter per agent: budget gets exactly the one tool it needs.
Fewer tools also means a smaller context and fewer wrong choices.
And the tools an agent does get, sort them by what they can break.

## 32 · Tool tiers  _(21:25)_

Read tools are the least dangerous, but watch what comes back: untrusted text and customer data.
Reversible writes, like restart, rollback or a feature flag, need a person, and the approval is bound to the exact arguments the person saw.
Irreversible tools, a refund, a delete, a signed contract, a public post, get an approval and live only on the agent that talks to the person. An approval request from deep inside a delegation is hard to explain to whoever has to click.
And behind every tool: credentials that can do exactly this and nothing more. That's the boundary that holds when everything else fails.
Read tools sound harmless. They aren't.

## 33 · Untrusted text  _(22:00)_

Everything a tool returns goes into the context, and the model can't reliably tell data from instructions. A talk abstract, a support mail, a log line can say "ignore all previous instructions". That's prompt injection.
You won't filter it away reliably. So limit what it can reach: the agent that reads untrusted text holds only read tools. It hands over findings in fixed fields, not free text. The agent with write tools never sees the original text, and its writes still need approval.
That's the Capabilities C in practice. The incident desk has exactly this case: a log line with an injection in it. And findings in fixed fields is already a rule for handoffs.
In the demo you'll see both sides on purpose: the workflow follows this rule. The chat commander doesn't: it reads the ticket and holds write tools, so there the approval is the last line of defence. That's the compromise a chat makes.

## 34 · Handoffs  _(22:40)_

Every edge in a network is a handoff, and that's where systems leak.
In the incident desk, the supervisor happily copied the customer's e-mail address into the delegation prompt. You'll see the filter that catches it in a few minutes. So at every handoff: filter what the next agent may see. Enforce limits on depth and messages in code. And fail closed: if your filter throws, the delegation must fail, not continue unfiltered. In Mastra that's a setting you have to change.
And if the next agent needs the whole chat history, you split in the wrong place. Hand over structured findings instead.
Tools are bounded now. But some decisions shouldn't be made by any agent.

## 35 · Chapter: Users intervene  _(23:25)_

Chapter four: users intervene. They want to approve, correct, or say no. How does a person stay in control without watching every step?
Two parts: the wire to the person, and the screen.

## 36 · AG-UI  _(23:40)_

AG-UI is the wire from the agent system to the person. About thirty typed events: a run starts, text streams, tool calls stream their arguments, sub-agents start and finish, state is synced.
The one that matters most: a run can end with an interrupt. I need a human decision. The UI shows a card, a person approves or rejects with a reason, and the answer starts run 2, which resumes where the agent stopped.
Nothing waits in memory in between. That's the pause and resume from chapter two. AG-UI only carries the question to the UI and the answer back. CopilotKit is built on it, and the incident desk chat speaks it.
AG-UI gets the question onto the screen. What should the screen show?

## 37 · Human in the loop  _(24:25)_

Human in the loop is usually drawn as a little box saying "human". In reality it's a user interface, and a hard one.
Show the exact arguments and bind the approval to them: if the arguments change after I clicked yes, my yes doesn't count. Show the evidence, not only the action. A "no" needs a reason, and the agent must actually receive it. In my stack the reason got lost on the way, and I had to fix it in the UI. The approver is a signed-in person with a role, every decision is logged, and approvals expire.
And don't ask people things they can't judge. That only trains them to click yes.
The approval card is one example of generative UI. Instead of text, the agent picks a component, a room plan, a budget bar, this card, and the app renders it. The agent decides what to show, the app decides how. It never gets to send its own HTML. That's a capability boundary again.
Let's see chapters three and four together, with the incident commander.
[DEMO Desk 2, 2:15: Chat tab, 1 Investigate (redaction cards, read-only specialists), 2 Mitigate, decline with "Change freeze until 16:00", Mitigate again, approve. Then slide 38.]

## 38 · Does it work?  _(27:30)_

Back to the slides. Four problems, four answers, and you've seen most of them work.
The abstract promised you design, test and debug. So the last part: how do you see what really happens in a system like this, how do you find a bug, and how do you keep it fixed?

## 39 · What a trace shows  _(27:50)_

Observability for agents means tracing. Every run becomes a tree of spans: each model call, each tool call, each delegation or A2A call, each approval, with input, output, tokens and time.
This is a decentralized run from the conference planner. Venue assigns the rooms and posts the cost, venue asks accessibility, budget reads the board, venue drops a room. Every step is a span you can open. And there's a bug hiding in this tree. Don't hunt for it yet: we'll find it live at the end, in the real trace.
In Mastra the traces show up in Studio. With OpenTelemetry you can send them to any tool you already use, and Microsoft Agent Framework emits OpenTelemetry too.
So how do you get from a trace to a fix?

## 40 · Debugging  _(28:40)_

I ask the trace four questions. Who saw what: what was in the context of the call that went wrong? Which tools were offered? Why did it delegate, and to whom? And how did it stop: done, budget, limit, or error?
Then find the first wrong span. Not the last one, the first. Replay the run, with the recorded model responses or a scripted model, so you can reproduce it without paying for it or getting a different answer. Fix the boundary, not the prompt: a filter, a tool set, a limit, an order of steps. You'll see one of those fixes at the end, for the bug in that tree. And add a test so it stays fixed.
Which leads to testing.

## 41 · Observe and test  _(29:30)_

How do you test something non-deterministic? Split the question.
Architecture tests check the wiring: who can call which tool, is every risky tool gated, does personal data reach an agent that shouldn't see it. You don't need a real model for that. A scripted model is better: deterministic, offline, fast enough to run on every commit. In my demo repo they run offline in about half a minute.
Behavioural evals check what the real model does: does it find the cause, does it respect a no. Run them many times and look at pass rates. In Mastra that's a scorer. In my demo, code scorers check what code can check: did it find the real cause, did the answer repeat customer data. And an LLM as judge grades what code can't: is the answer grounded, safe and actionable. Every live run gets scored, and the scores sit in Studio next to the trace. And these evals answer the question from chapter one: does one agent still pass?
None of this needs a specific framework. My demo uses Mastra, a TypeScript framework, because it has workflows, supervisors, memory, tracing and a local Studio in one package. Microsoft Agent Framework has the same building blocks for .NET: agents as functions, workflows with checkpoints, approval-required functions, OpenTelemetry, A2A and AG-UI hosting.
That's the theory. Now all of it in one example: the conference planner.

## 42 · Example: the planner  _(30:15)_

The incident desk showed boundaries around one supervisor. Now back to chapter one: several specialists, and the question whether a network helps. The example: we're planning a developer conference, VibeKode 2027 in Mainz. 600 people, three tracks, a budget of 180,000 euros. Seven specialists with their own data and their own write tools. They run as A2A services. And it's ordinary planning software: the agents write into the plan, and every entry says who wrote it.
Three parts. First, the same small question in three architectures. It touches three specialists only, venue, accessibility and budget, so the runs stay short. Second, travel for the four speakers from the US: passports, flights, hotels, and a booking that needs a person. I'll say no once. Third, we look for a bug in the trace.
[DEMO, see cheat sheet. About 10 minutes.]

## 43 · What the demos showed  _(40:45)_

Let's put it together. [Compare runs tab: numbers from the runs you just saw, one run each, not a benchmark.]
For the room question the single agent was fastest and complete. Centralized ran three specialists in parallel, but the Room C problem had to travel through the supervisor. Decentralized: venue asked accessibility directly, but budget read the board before venue had updated it. The blackboard weakness, found in the trace.
For travel the picture turns. In the network only the travel agent ever saw a passport number, and the booking waited for a person. The single agent had to hold all of it.
So the network helped where the data was really separate. It cost wherever the agents needed each other. That's one run each, an illustration, not a benchmark. But it matches what the research said.
And a fair objection on travel: a single agent with a passport tool that never returns the numbers would protect them too. Good tool design gets you far. The network makes the boundary structural: the data never leaves the agent that owns it.
And the incident desk showed the other half: whatever the shape, the boundaries decide. Who sees what, who may do what, and who decides.

## 44 · Takeaways  _(41:30)_

Back to the question from the beginning. Use one agent as long as it passes your evals; it's cheaper. When it doesn't, split along context, capabilities, cost or clock. Everything else is a prompt conference.
And one sentence per chapter. Several specialists: pick the shape by who owns the answer. Long tasks: a workflow around the agent, state in storage, and decide what is remembered. Risky tools: the smallest tool set, sorted by what it can break, filtered at every handoff. People: an approval is a run that stops and a UI that shows the exact arguments. And trace everything, so you can debug it and keep it fixed.
The planner showed when a network helps. The incident desk showed that the boundaries matter in every shape.
A prompt asks. A boundary decides.

## 45 · Thank you  _(43:00)_

Thank you! The demo runs offline without an API key, so you can try it on the train home. Questions?
The repo is on screen: github.com/melanie-bauer/agent-architecture.
[TODO before the talk: add LinkedIn to this slide if you want it on screen.]

## 46 · Sources

Backup slide.
