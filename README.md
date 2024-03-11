# HuntBot

My exploration building a portfolio that uses a personal LLM, _HuntBot_, to navigate users around the site and help sell Hunter as a high quality job candidate.

HuntBot has been built using the following technologies:

- Typescript because types are good
- Svelte/SvelteKit as the meta-framework, just because I've heard good things and it's a nice developer experience.
- Prismic as my CMS. I experimented with Sanity and Payload, but I liked Prismic for:
  - Local GUI front end for configuring data models
  - Slicemachine for simulating pages before publishing
  - Generated types for data models
  - Decent documentation for use with SvelteKit
- Langchain JS is used, but only for handling my Retrieval Augmented Generation (RAG) pipeline. I initially did my RAG manually, but found that Langchain has nice abstractions for things like connecting to Pinecone and loading documents to embed from various sources (I load documents from Notion, obscure .txts, .csvs, and from random URLS).
- Pinecone as my Vector DB to hold embeddings. I only chose this because they have an easy-to-setup serverless option, and I'm small enough where I can live on the free tier.
- Vercel AI SDK is the backbone for getting streaming chat responses from the server, and handling OpenAI function calls via its function handler (both on server & on client). The final API call to the LLM isn't done with Langchain, rather the vanilla OpenAI NPM module. The reason being that I wasn't able to find a good way to get Langcahin and the Vercel AI SDK to work together with OpenAI function calling AND streaming.

## Setup

To configure a compatible assistant, use the models `gpt-3.5-turbo` or `gpt-4-turbo-preview`.
The frontend expects two environmental variables to connect with Open AI:

The project expects several environmental variables to connect with various APIs and hold various secrets:

```bash
export OPENAI_API_KEY="..."
export OPENAI_ASISTANT_ID="..."
export JWT_KEY="..."
export AUTH_PASSWORD="..."
export ADMIN_PASSWORD="..."
export PINECONE_API_KEY="..."
export PINECONE_INDEX="..."
export NOTION_INTEGRATION_TOKEN="..."
```

The auth password is what site visitors must use to gain access to protected case studies. The admin password is used for access to the admin tools. Right now this include the triggers for embedding new data to the vector DB.

At the time of writing, HuntBot supports the functions that the LLM can call:

```bash
#Minimize chat
#Will minimize the chat

{
	"name":  "minimize_chat",
	"description":  "Minimize the chat interface in which this thread is taking place.",
	"parameters":  {
		"type":  "object",
		"properties":  {},
		"required": []
	}
}
```

```bash
#Route to page
#Will route the site visitor to the relevant page based on the conversation

{
	"name":  "route_to_page",
	"description":  "Route the user to a new url on the site. Only route to one at a time.",
	"parameters":  {
		"type":  "object",
		"properties":  {
			"page":  {
				"type":  "string",
				"enum": [
				"/case-studies/slug",
				"/case-studies/slug-2",
				...
				]
			}
		},
		"required": [
			"page"
		]
	}
}
```

Currently, the enum values that route_to_page can return are hardcoded to individual routes on the frontend. You can find the corresponding types for both functions and the enum [here.](packages/huntbot-frontend/src/lib/types.d.ts) This is a temporary solution, but in the future it would be ideal to dynamically populate the assistant's possible routes via a Prismic API call.

## RAG Pipeline

At the time of this commit, the pipeline used for the LLM is as follows:

- User submits a message in the client
- The /api/chat endpoint receives the message
  1. Initialize a new OpenAI client
  2. Reformat the user's message based on the past few messages in the chat history as context
     - If the user asks a specific question with no ambiguity, the vector search is generally good at returning relevant context. Example: `"What engineering classes did Hunter take while at USC?"`
     - If the user uses an unclear antecedent, or doesn't provide relevant context in the question itself, the vector search generally won't return relevant context. Example: `"What classes did he take?"`
     - Without reformatting the message, ambiguous questions can't create an embedding that contains relevant information. So, we add a step to call an LLM once more to rewrite the question with complete context. To do so, we feed it the previous few messages in the chat history, and return a reformatted response. Via experimentation, too much history will make the LLM lose "focus", but too little won't add the appropriate context. Something in the range of 3-5 past messages seems to work, including the previous LLM responses.
     - At the time of writing, I'm using the gpt-3.5-turbo model. GPT 4 turbo works well, but the api costs are high (~20x in this case)
  3. Retrieve context from the vector DB based on the reformatted user message
     - With the previous reformatted user message as input, we create an embedding of the question.
     - We perform a vector search in the vector DB for nearby entries.
     - We get the top results, and filter out by our set minimum score (throw away entries that aren't similar enough)
     - Reformat the entries as a single string
  4. Submit full chat history and retrieved context in an api call to the LLM
     - At the time of writing, I'm using the gpt-3.5-turbo model. GPT 4 turbo works well, but the api costs are high (~20x in this case)
  5. Return a streaming response to the client via the Vercel AI SDK
  6. Handle any function calls returned from the LLM via the Vercel AI SDK's function handler callback

Any step in this pipeline is subject to change. I'm looking into other approaches for better responses. Other things on my list include:

- Multi Query Retreival - Create several reformatted responses to perform vector search against. Helps find multiple separate relevant pieces of information form a query.
- Multi Vector Retreival - I'm particularly interested in creating embeddings for the summary of a document as well as the embedding of the content itself.
- Indexing - Help manage the entries in my vector db and delete duplicates
- Generally clean up dataset - Most embeddings were from raw data I tossed over the fence. Since it's from different sources, it would be nice to add metadata where appropriate. This could help create more focused context and enable self-querying retreival, where the LLM writes a metadata filter.
