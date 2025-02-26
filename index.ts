#!/usr/bin/env node

import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import OpenAI from "openai";
import { Command } from "commander";

// -----------------------------
// Global OpenAI instance
// -----------------------------
let openai: OpenAI | null = null;

// -----------------------------
// Type definitions
// -----------------------------
interface HistoryData {
  // Add an optional property to store the user's API key
  openAiApiKey?: string;
  rawTextsUsed: string[];
  sessions: {
    id: number;
    selectorText: string;
    filePath1: string;
    filePath2: string;
    taskPrompt: string;
    timestamp: string;
  }[];
}

interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CurrentAIConversation {
  messages: AIMessage[];
}

// -----------------------------
// Initialize OpenAI client
// -----------------------------
export const initializeClient = async (apiKey: string) => {
  if (apiKey) {
    openai = new OpenAI({ apiKey });
  } else {
    throw new Error("Failed to initiate OpenAI Client");
  }
  return openai;
};

// -----------------------------
// Send a message to ChatGPT with stream
// -----------------------------
export const sendMessageToChatGPTWithStream = async (
  conversation: CurrentAIConversation,
  model: string = "gpt-4o-mini", // e.g. "gpt-3.5-turbo" | "gpt-4o" | "gpt-4o-mini"
  temperature?: number
): Promise<string> => {
  if (!openai) {
    throw new Error("OpenAI not initialized");
  }

  // Create a streaming chat completion
  const completion = await openai.chat.completions
    .create({
      messages: conversation.messages,
      model,
      temperature,
      stream: true,
    })
    .catch((err: any) => {
      console.log(err);
      throw new Error("Error in stream");
    });

  let message = "";
  for await (const event of completion) {
    if (event.choices[0].delta.content) {
      // Stream it directly to the console (optional)
      process.stdout.write(event.choices[0].delta.content);
      message += event.choices[0].delta.content;
    }
  }

  return message;
};

// -----------------------------
// Local "DB" file management
// -----------------------------
const HISTORY_FILE = path.join(__dirname, ".cli-history.json");

/** Load history file or return default if it doesn't exist */
function loadHistory(): HistoryData {
  try {
    const data = fs.readFileSync(HISTORY_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    // If file not found or parse error, return default
    return {
      openAiApiKey: undefined,
      rawTextsUsed: [],
      sessions: [],
    };
  }
}

/** Write updated history data back to file */
function saveHistory(historyData: HistoryData) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyData, null, 2), "utf-8");
}

// -----------------------------
// Main CLI logic
// -----------------------------
async function main() {
  console.log("Welcome to the File Comparison + LLM CLI!\n");

  // 1) Load existing history
  const history = loadHistory();

  // 2) Check for OpenAI API key, prompt if missing
  if (!history.openAiApiKey) {
    const { apiKey } = await inquirer.prompt([
      {
        name: "apiKey",
        type: "input",
        message: "Please enter your OpenAI API key:",
      },
    ]);
    history.openAiApiKey = apiKey.trim();
    saveHistory(history);
  }

  // 3) Initialize OpenAI client with stored key
  await initializeClient(history.openAiApiKey!);

  // 4) Ask user for the first step: Either pick from existing raw texts or enter a new one
  const rawTextChoices = history.rawTextsUsed.length
    ? [...history.rawTextsUsed, new inquirer.Separator(), "Enter new text"]
    : ["Enter new text"];

  const { selectedOrNew } = await inquirer.prompt([
    {
      name: "selectedOrNew",
      type: "list",
      message: "Select step or enter a new one:",
      choices: rawTextChoices,
    },
  ]);

  let selectorText = selectedOrNew;
  if (selectedOrNew === "Enter new text") {
    const { newSelectorText } = await inquirer.prompt([
      {
        name: "newSelectorText",
        type: "input",
        message: "Enter the raw text for this step:",
      },
    ]);
    selectorText = newSelectorText;
    // Save new text to history if it's non-empty
    if (selectorText.trim()) {
      history.rawTextsUsed.push(selectorText);
    }
  }

  // 5) Prompt for file paths and optional prompt
  const answers = await inquirer.prompt([
    {
      name: "filePath1",
      type: "input",
      message: "Enter the absolute path of the first file:",
    },
    {
      name: "filePath2",
      type: "input",
      message: "Enter the absolute path of the second file:",
    },
    {
      name: "taskPrompt",
      type: "input",
      message: "(Optional) Enter the LLM task or prompt (press enter to skip):",
      default: "",
    },
  ]);

  // 6) Read file contents
  let fileContent1 = "";
  let fileContent2 = "";

  try {
    fileContent1 = fs.readFileSync(path.resolve(answers.filePath1), "utf-8");
  } catch (err) {
    console.error("Could not read first file:", err);
    return;
  }

  try {
    fileContent2 = fs.readFileSync(path.resolve(answers.filePath2), "utf-8");
  } catch (err) {
    console.error("Could not read second file:", err);
    return;
  }

  // 7) Prepare conversation for the LLM (omitting the selectorText by request)
  const conversation: CurrentAIConversation = {
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant that compares two files and provides insights.",
      },
      {
        role: "user",
        content: `
I have two files.

File 1 Content:
${fileContent1}

File 2 Content:
${fileContent2}

Task: ${answers.taskPrompt || "Compare and analyze the differences."}
`,
      },
    ],
  };

  // 8) Call the LLM with streaming response
  console.log("\n--- LLM Response (streaming) ---\n");
  let response: string;
  try {
    response = await sendMessageToChatGPTWithStream(
      conversation,
      "gpt-4o-mini",
      0.7
    );
  } catch (error) {
    console.error("\nError calling LLM:", error);
    return;
  }

  // 9) Print final response again if desired
  console.log("\n\n--- LLM Response (complete) ---\n", response);

  // 10) Save entire session to history
  const newSessionId = history.sessions.length + 1;
  history.sessions.push({
    id: newSessionId,
    selectorText,
    filePath1: answers.filePath1,
    filePath2: answers.filePath2,
    taskPrompt: answers.taskPrompt,
    timestamp: new Date().toISOString(),
  });

  // 11) Write updated history
  saveHistory(history);

  console.log("\nSession saved. Goodbye!");
}

// Run the script
// main().catch((err) => {
//   console.error(err);
//   process.exit(1);
// });

const program = new Command();

program
  .command("compare")
  .description("Compare two files and get streaming LLM output.")
  .action(async () => {
    // Move your entire 'main()' logic in here or call main():
    await main();
  });

program.parse(process.argv);
