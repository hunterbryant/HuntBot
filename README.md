# HuntBot

My exploration in connecting OpenAI Assistant function calling to my sites routing and other functions.

I'm documenting this project on Notion. Invite only [request access here](https://www.notion.so/hunterbryant/HuntGPT-7deb24a1ff044f4eafe30146493cd7df?pvs=4)

## Developing

Create a project and installed dependencies with `pnpm install`, start with:

```bash
pnpm run dev

```

## Building

To create a production version of your app:

```bash
npm run build
```

## Setup

HuntBot has been built on Open AI's Assistants API. To configure a compatible assistant, use the models `gpt-3.5-turbo-1106` or `gpt-4-1106-preview`. These are the only options as of Dec 2023 that support Function Calling and Retreival.

The frontend expects two environmental variables to connect with Open AI:

```bash
export OPENAI_API_KEY=...
export OPENAI_ASISTANT_ID=...
```

At the time of writing, HuntBot supports two functions:

```bash
#Minimize chat
{
  "name": "minimize_chat",
  "description": "Minimize the chat interface in which this thread is taking place.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

```bash
#Route to page
{
  "name": "route_to_page",
  "description": "Route the user to a new url on the site. Only route to one at a time.",
  "parameters": {
    "type": "object",
    "properties": {
      "page": {
        "type": "string",
        "enum": [
          "gathers-app",
          "karoo-2",
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

Currently, the enum values that route_to_page can return are hardcoded to individual routes on the frontend. You can find the corresponding types for both functions and the enum [here.](packages/huntbot-frontend/src/lib/types.d.ts) This is a temporary solution, but in the future it would be ideal to dynamically populate the assistant's possible routes.
