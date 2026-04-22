import React, { useState, useEffect } from 'react';
import { render, Text, Box, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { Ollama } from 'ollama';
import { exec } from 'child_process';
import util from 'util';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { getGatewayIp, getSystemContext } from './system.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', '.env');

// Load environment variables
dotenv.config({ path: envPath });

const execAsync = util.promisify(exec);

// Initialization Context
const gatewayIp = getGatewayIp();
const sysCtx = getSystemContext();
const ollama = new Ollama({ host: `http://${gatewayIp}:11434` });
const HISTORY_FILE = path.join(os.homedir(), '.monster_history.json');

const DEVICE_INFO = `[SYSTEM PROFILE]
User: ${sysCtx.user} | Local IP: ${sysCtx.localIp}
Gateway: ${gatewayIp} | Hardware: Lenovo Legion Pro 5 (RTX 5070)
OS: Kali Linux VM | Permissions: FULL ROOT ACCESS`;

const SYSTEM_PROMPT = `You are MONSTER-AI, an elite Kali Linux Expert Assistant.
Context: ${DEVICE_INFO}
You have a tool called 'run_command' to run shell commands in the Kali terminal.
If the user asks you to perform a task, use the tool. If they just ask a question, answer natively.
Keep your responses concise and hacker-oriented.`;

// History helpers
const loadHistory = () => {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (e) {}
    return [{ role: 'system', content: SYSTEM_PROMPT }];
};

const saveHistory = (hist: any) => {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(hist, null, 2));
    } catch (e) {}
};

setTimeout(() => {}, 0); // Keep alive if removed
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'qwen2.5-coder:32b';

// App Component
const MonsterAgent = () => {
    const { exit } = useApp();
    const [model, setModel] = useState<string>(DEFAULT_MODEL); // Default
    const [history, setHistory] = useState<Array<{ role: string, content: string, tool_calls?: any, name?: string }>>(loadHistory());
    const [input, setInput] = useState('');
    const [status, setStatus] = useState<'idle' | 'thinking' | 'confirming_exec'>('idle');
    const [pendingCmd, setPendingCmd] = useState<string>('');
    const [availableModels, setAvailableModels] = useState<string[] | null>(null);

    const updateHistory = (newHist: any) => {
        setHistory(newHist);
        saveHistory(newHist);
    };

    // Ask Ollama
    const handleSubmit = async (q: string) => {
        if (!q.trim()) return;

        if (availableModels !== null) {
            const val = q.trim();
            if (val.toLowerCase() === 'cancel' || val === '0') {
                updateHistory([...history, { role: 'user', content: q }, { role: 'assistant', content: '[!] Model selection cancelled.' }]);
                setAvailableModels(null);
            } else {
                const num = parseInt(val);
                if (!isNaN(num) && num > 0 && num <= availableModels.length) {
                    const newModel = availableModels[num - 1];
                    setModel(newModel);
                    updateHistory([...history, { role: 'user', content: q }, { role: 'assistant', content: `[+] Agent Model changed to: ${newModel}` }]);
                    setAvailableModels(null);
                } else {
                    updateHistory([...history, { role: 'user', content: q }, { role: 'assistant', content: `[!] Invalid selection. Enter 1-${availableModels.length} or '0' to cancel.` }]);
                }
            }
            setInput('');
            return;
        }

        if (q.toLowerCase() === '/model') {
            setStatus('thinking');
            try {
                const res = await ollama.list();
                const names = res.models.map((m: any) => m.name);
                if (names.length === 0) {
                    updateHistory([...history, { role: 'user', content: q }, { role: 'assistant', content: '[!] No models found in Ollama.' }]);
                } else {
                    setAvailableModels(names);
                    const listStr = names.map((n: string, i: number) => `[${i + 1}] ${n}`).join('\n');
                    updateHistory([...history, { role: 'user', content: q }, { role: 'assistant', content: `[?] Select a model by number:\n${listStr}\n\n[0] Cancel` }]);
                }
            } catch (err: any) {
                updateHistory([...history, { role: 'user', content: q }, { role: 'assistant', content: `[!] Failed to list models: ${err.message}` }]);
            }
            setStatus('idle');
            setInput('');
            return;
        }

        if (q.toLowerCase() === 'exit') { exit(); return; }
        if (q.toLowerCase() === 'help') {
            const helpMsg = `[!] MONSTER-AI AGENT CONTROLS:
- help          : Show this help message
- exit          : Exit the agent
- clear history : Clear the current chat history and memory
- /model        : Show models list and select by number (or /model <name>)
- scan network  : (Example) Tell AI to run nmap
  (You can ask any tool or linux action normally)`;
            updateHistory([...history, { role: 'user', content: q }, { role: 'assistant', content: helpMsg }]);
            setInput('');
            return;
        }
        if (q.toLowerCase() === 'clear history') {
            updateHistory([{ role: 'system', content: SYSTEM_PROMPT }]);
            return;
        }

        if (q.toLowerCase().startsWith('/model ')) {
            const newModel = q.substring(7).trim();
            setModel(newModel);
            updateHistory([...history, { role: 'user', content: q }, { role: 'assistant', content: `[+] Agent Model changed to: ${newModel}` }]);
            setInput('');
            return;
        }

        const newHistory = [...history, { role: 'user', content: q }];
        updateHistory(newHistory);
        setInput('');
        setStatus('thinking');

        try {
            const res = await ollama.chat({
                model: model,
                messages: newHistory,
                tools: [{
                    type: 'function',
                    function: {
                        name: 'run_command',
                        description: 'Execute a bash command in the terminal',
                        parameters: {
                            type: 'object',
                            properties: {
                                command: { type: 'string', description: 'The bash command to run' }
                            },
                            required: ['command']
                        }
                    }
                }]
            });

            const msg = res.message;
            let parsedToolCall = null;

            if (msg.tool_calls && msg.tool_calls.length > 0) {
                parsedToolCall = msg.tool_calls[0].function.arguments.command;
            } else if (msg.content) {
                try {
                    const parsed = JSON.parse(msg.content.trim());
                    if (parsed.name === 'run_command' && parsed.arguments && parsed.arguments.command) {
                        parsedToolCall = parsed.arguments.command;
                    }
                } catch (e) {}
            }

            const updatedHistory = [...newHistory, msg];
            updateHistory(updatedHistory);

            if (parsedToolCall) {
                setPendingCmd(parsedToolCall as string);
                setStatus('confirming_exec');
            } else {
                setStatus('idle');
            }
        } catch (e: any) {
            updateHistory([...newHistory, { role: 'assistant', content: `[!] Connection Error: ${e.message}` }]);
            setStatus('idle');
        }
    };

    // Handle execution confirmation
    const handleConfirm = async (val: string) => {
        if (val.toLowerCase() === 'y') {
            setStatus('thinking');
            try {
                // Get your 'sudo' password from .env or prompt
                const SUDO_PASSWORD = process.env.SUDO_PASSWORD || 'kali'; // Optional Fallback to kali if .env empty
                
                const runStr = pendingCmd.startsWith('sudo ') 
                    ? `echo ${SUDO_PASSWORD} | sudo -S ${pendingCmd.substring(5)}` 
                    : pendingCmd;

                const { stdout, stderr } = await execAsync(runStr);
                const out = stdout ? stdout.trim() : (stderr ? stderr.trim() : '[Command ran successfully with no output]');
                
                // Add tool result back to model to get final comment
                const toolHistory = [...history, { role: 'tool', content: out.substring(0, 4000), name: 'run_command' }];
                updateHistory(toolHistory);
                
                const finalRes = await ollama.chat({
                    model: model,
                    messages: toolHistory
                });

                updateHistory([...toolHistory, finalRes.message]);
            } catch (err: any) {
                updateHistory([...history, { role: 'assistant', content: `[!] Error running command: ${err.message}` }]);
            }
        } else {
            // Cancelled
            updateHistory([...history, { role: 'assistant', content: `[!] Command execution cancelled by user.` }]);
        }
        
        setPendingCmd('');
        setStatus('idle');
    };

    return (
        <Box flexDirection="column" paddingLeft={1} paddingTop={1}>
            {/* Header */}
            <Box borderStyle="round" borderColor="redBright" paddingX={2} paddingY={1} flexDirection="row" marginBottom={1}>
                {/* Binary Skull ASCII Art */}
                <Box flexDirection="column" marginRight={4}>
                    <Text color="redBright" bold>   0100101   </Text>
                    <Text color="redBright" bold> 101     011 </Text>
                    <Text color="redBright" bold>11  0   0  11</Text>
                    <Text color="redBright" bold>01  ▄▄▄▄▄  10</Text>
                    <Text color="redBright" bold>  101101101  </Text>
                </Box>
                
                {/* System Info */}
                <Box flexDirection="column" justifyContent="center">
                    <Box marginBottom={1}>
                        <Text color="redBright" bold>[!] MONSTER HACKER AGENT </Text>
                        <Text color="dim"> {model} </Text>
                    </Box>
                    <Box flexDirection="row">
                        <Box marginRight={2}><Text color="dim">User:</Text><Text color="white" bold> {sysCtx.user}</Text></Box>
                        <Box marginRight={2}><Text color="dim">IP:</Text><Text color="cyan"> {sysCtx.localIp}</Text></Box>
                        <Box><Text color="dim">Gateway:</Text><Text color="cyan"> {gatewayIp}</Text></Box>
                    </Box>
                </Box>
            </Box>

            {/* Chat History */}
            <Box flexDirection="column" marginBottom={1}>
                {history.filter(h => h.role !== 'system' && h.role !== 'tool').map((msg, i) => (
                    <Box key={i} flexDirection="column" marginTop={1}>
                        {msg.role === 'user' ? (
                            <Box flexDirection="row">
                                <Text color="redBright" bold>╭─</Text>
                                <Text color="cyan" bold> {sysCtx.user}@kali </Text>
                                <Text color="dim">in </Text>
                                <Text color="yellow" bold>~ </Text>
                                <Text color="dim">❯ </Text>
                                <Text color="white">{msg.content}</Text>
                            </Box>
                        ) : (
                            <Box flexDirection="column" paddingLeft={2} borderStyle="single" borderColor="green">
                                <Text bold color="green">[MONSTER-AI]</Text>
                                {msg.content && <Box marginTop={1}><Text color="white">{msg.content}</Text></Box>}
                            </Box>
                        )}
                        {/* Tool Calls */}
                        {msg.role === 'assistant' && msg.tool_calls && (
                            <Box flexDirection="row" paddingLeft={3} marginTop={1}>
                                <Text color="yellow">[*] Executing Command: </Text>
                                <Text color="dim">[{msg.tool_calls[0].function.arguments.command}]</Text>
                            </Box>
                        )}
                    </Box>
                ))}
            </Box>

            {/* Loading State */}
            {status === 'thinking' && (
                <Box marginTop={1} paddingLeft={2} borderStyle="single" borderColor="magenta">
                    <Text color="magenta"><Spinner type="dots" /> Thinking...</Text>
                </Box>
            )}

            {/* Input State */}
            {status === 'idle' && (
                <Box flexDirection="column" marginTop={1}>
                    <Box flexDirection="row">
                        <Text color="redBright" bold>╭─</Text>
                        <Text color="cyan" bold> {sysCtx.user}@kali </Text>
                        <Text color="dim">in </Text>
                        <Text color="yellow" bold>~ </Text>
                    </Box>
                    <Box flexDirection="row">
                        <Text color="redBright" bold>╰─➤ </Text>
                        <Box paddingLeft={1}>
                            {(TextInput as any).default 
                                ? React.createElement((TextInput as any).default, { value: input, onChange: setInput, onSubmit: handleSubmit }) 
                                : <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
                            }
                        </Box>
                    </Box>
                </Box>
            )}

            {/* Execution Confirmation */}
            {status === 'confirming_exec' && (
                <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1}>
                    <Text color="yellow" bold>[!] ACTION REQUIRED: Tool Execution</Text>
                    <Box marginY={1}>
                        <Text color="white">The AI wants to run the following bash command:</Text>
                    </Box>
                    <Box paddingLeft={2} marginBottom={1}>
                        <Text color="cyan">{pendingCmd}</Text>
                    </Box>
                    <Box flexDirection="row">
                        <Text color="redBright" bold>Execute? [y/N] ➤ </Text>
                        <Box paddingLeft={1}>
                            {(TextInput as any).default 
                                ? React.createElement((TextInput as any).default, { value: "", onChange: handleConfirm }) 
                                : <TextInput value={""} onChange={handleConfirm} />
                            }
                        </Box>
                    </Box>
                </Box>
            )}
        </Box>
    );
};

render(<MonsterAgent />);
