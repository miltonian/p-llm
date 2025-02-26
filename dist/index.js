#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMessageToChatGPTWithStream = exports.initializeClient = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const inquirer_1 = __importDefault(require("inquirer"));
const openai_1 = __importDefault(require("openai"));
const commander_1 = require("commander");
// -----------------------------
// Global OpenAI instance
// -----------------------------
let openai = null;
// -----------------------------
// Initialize OpenAI client
// -----------------------------
const initializeClient = async (apiKey) => {
    if (apiKey) {
        openai = new openai_1.default({ apiKey });
    }
    else {
        throw new Error("Failed to initiate OpenAI Client");
    }
    return openai;
};
exports.initializeClient = initializeClient;
// -----------------------------
// Send a message to ChatGPT with stream
// -----------------------------
const sendMessageToChatGPTWithStream = async (conversation, model = "gpt-4o-mini", // e.g. "gpt-3.5-turbo" | "gpt-4o" | "gpt-4o-mini"
temperature) => {
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
        .catch((err) => {
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
exports.sendMessageToChatGPTWithStream = sendMessageToChatGPTWithStream;
// -----------------------------
// Local "DB" file management
// -----------------------------
const HISTORY_FILE = path_1.default.join(__dirname, ".cli-history.json");
/** Load history file or return default if it doesn't exist */
function loadHistory() {
    try {
        const data = fs_1.default.readFileSync(HISTORY_FILE, "utf-8");
        return JSON.parse(data);
    }
    catch (err) {
        // If file not found or parse error, return default
        return {
            openAiApiKey: undefined,
            rawTextsUsed: [],
            sessions: [],
        };
    }
}
/** Write updated history data back to file */
function saveHistory(historyData) {
    fs_1.default.writeFileSync(HISTORY_FILE, JSON.stringify(historyData, null, 2), "utf-8");
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
        const { apiKey } = await inquirer_1.default.prompt([
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
    await (0, exports.initializeClient)(history.openAiApiKey);
    // 4) Ask user for the first step: Either pick from existing raw texts or enter a new one
    const rawTextChoices = history.rawTextsUsed.length
        ? [...history.rawTextsUsed, new inquirer_1.default.Separator(), "Enter new text"]
        : ["Enter new text"];
    const { selectedOrNew } = await inquirer_1.default.prompt([
        {
            name: "selectedOrNew",
            type: "list",
            message: "Select step or enter a new one:",
            choices: rawTextChoices,
        },
    ]);
    let selectorText = selectedOrNew;
    if (selectedOrNew === "Enter new text") {
        const { newSelectorText } = await inquirer_1.default.prompt([
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
    const answers = await inquirer_1.default.prompt([
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
        fileContent1 = fs_1.default.readFileSync(path_1.default.resolve(answers.filePath1), "utf-8");
    }
    catch (err) {
        console.error("Could not read first file:", err);
        return;
    }
    try {
        fileContent2 = fs_1.default.readFileSync(path_1.default.resolve(answers.filePath2), "utf-8");
    }
    catch (err) {
        console.error("Could not read second file:", err);
        return;
    }
    // 7) Prepare conversation for the LLM (omitting the selectorText by request)
    const conversation = {
        messages: [
            {
                role: "system",
                content: "You are a helpful assistant that compares two files and provides insights.",
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
    let response;
    try {
        response = await (0, exports.sendMessageToChatGPTWithStream)(conversation, "gpt-4o-mini", 0.7);
    }
    catch (error) {
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
const program = new commander_1.Command();
program
    .command("compare")
    .description("Compare two files and get streaming LLM output.")
    .action(async () => {
    // Move your entire 'main()' logic in here or call main():
    await main();
});
program.parse(process.argv);
