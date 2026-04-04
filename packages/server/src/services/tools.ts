import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import util from 'util';
import Database from 'better-sqlite3';
import type { Tool } from '../types/index.js';
// Browser service is lazy-loaded — only initialized when Agent actually uses browser tools
let _browserService: any = null;
async function getBrowserService() {
    if (!_browserService) {
        const mod = await import('./browser-service.js');
        _browserService = mod.browserService;
    }
    return _browserService;
}
// GUI service is lazy-loaded to avoid startup side effects (directory creation, script writing)
let _guiService: any = null;
async function getGuiService() {
    if (!_guiService) {
        const mod = await import('./gui-service.js');
        _guiService = mod.guiService;
    }
    return _guiService;
}
// Docker sandbox is lazy-loaded — most agents don't need it
let _dockerSandboxService: any = null;
async function getDockerSandboxService() {
    if (!_dockerSandboxService) {
        const mod = await import('./docker-sandbox.js');
        _dockerSandboxService = mod.dockerSandboxService;
    }
    return _dockerSandboxService;
}
import { fileSafetyService } from '../safety/file-safety.js';

const execAsync = util.promisify(exec);
const backgroundProcesses = new Map<string, any>();
let processIdCounter = 1;

// --- Tool Schemas ---

export const AgentTools: Tool[] = [
    {
        type: 'function',
        function: {
            name: 'clawhub_search',
            description: 'Search for skills on Clawhub.',
            parameters: {
                type: 'object',
                properties: {
                    keyword: { type: 'string', description: 'Search keyword for skills.' },
                    category: { type: 'string', description: 'Optional skill category to filter by.' },
                    page: { type: 'number', description: 'Optional page number for search results.' },
                    pageSize: { type: 'number', description: 'Optional page size for search results.' }
                },
                required: ['keyword']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'clawhub_download',
            description: 'Download and install a skill from Clawhub.',
            parameters: {
                type: 'object',
                properties: {
                    skillId: { type: 'string', description: 'ID of the skill to download.' }
                },
                required: ['skillId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'clawhub_list',
            description: 'List all installed skills.',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'clawhub_mcp_search',
            description: 'Search for MCP servers on Clawhub.',
            parameters: {
                type: 'object',
                properties: {
                    keyword: { type: 'string', description: 'Search keyword for MCP servers.' },
                    category: { type: 'string', description: 'Optional server category to filter by.' },
                    page: { type: 'number', description: 'Optional page number for search results.' },
                    pageSize: { type: 'number', description: 'Optional page size for search results.' }
                },
                required: ['keyword']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'clawhub_mcp_download',
            description: 'Download and install an MCP server from Clawhub.',
            parameters: {
                type: 'object',
                properties: {
                    serverId: { type: 'string', description: 'ID of the MCP server to download.' }
                },
                required: ['serverId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'clawhub_mcp_list',
            description: 'List all installed MCP servers.',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a local file.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute or relative path to the file.' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Create a new file or completely overwrite an existing file with new content.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute or relative path to the file.' },
                    content: { type: 'string', description: 'The raw text content to write into the file.' }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'exec_cmd',
            description: 'Execute a shell command. Use this to run scripts, install dependencies, or manage the system.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The shell command to execute.' },
                    cwd: { type: 'string', description: 'Optional current working directory.' }
                },
                required: ['command']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'web_search',
            description: 'Search the web for real-time information using DuckDuckGo.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'The search query.' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'edit_file',
            description: 'Edit a specific block of text in a local file.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute or relative path to the file.' },
                    old_string: { type: 'string', description: 'The exact string block to be replaced. Must match exactly including whitespace and line breaks.' },
                    new_string: { type: 'string', description: 'The new string block to insert.' }
                },
                required: ['path', 'old_string', 'new_string']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_file',
            description: 'Delete a file or directory.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute or relative path to the file or directory.' },
                    recursive: { type: 'boolean', description: 'Whether to delete directories recursively (default: true).' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'send_file',
            description: 'Send a local file to the user so they can download or view it in the chat interface.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute path to the file you want to send to the user.' },
                    description: { type: 'string', description: 'Optional description of the file.' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'manage_process',
            description: 'Manage long-running background processes (start, stop, list).',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'The action to perform: "start", "stop", or "list".' },
                    command: { type: 'string', description: 'The shell command to start. Required if action is "start".' },
                    id: { type: 'string', description: 'The process ID to stop. Required if action is "stop".' }
                },
                required: ['action']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'web_fetch',
            description: 'Fetch and read the pure text content of a specific web page URL.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'The URL of the webpage to fetch.' }
                },
                required: ['url']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'plan_and_execute',
            description: 'Create and execute a multi-step plan to solve complex problems.',
            parameters: {
                type: 'object',
                properties: {
                    problem: { type: 'string', description: 'The complex problem to solve.' },
                    plan: { type: 'array', items: { type: 'string' }, description: 'An array of steps to solve the problem.' }
                },
                required: ['problem', 'plan']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'send_message',
            description: 'Send an intermediate message to the user during task execution. Use this to report progress, ask for clarification, or provide status updates without ending the conversation. This tool can be called multiple times within a single task execution cycle.',
            parameters: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: 'The message content to send to the user.' },
                    type: { type: 'string', enum: ['progress', 'status', 'question', 'result'], description: 'The type of message: progress (task progress), status (current status), question (need clarification), result (intermediate result).' }
                },
                required: ['content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'set_reminder',
            description: '设置定时提醒。到期后系统会自动在当前对话中推送提醒消息给用户。支持自然语言时间描述，如 "5分钟"、"1小时"、"30秒"。也支持重复提醒。',
            parameters: {
                type: 'object',
                properties: {
                    message: { type: 'string', description: '提醒消息内容，到期后会自动发送给用户' },
                    delay: { type: 'string', description: '延迟时间，支持格式："5分钟"、"1小时"、"30秒"、"2h"、"10m"、"30s"、"300"(秒数)' },
                    repeat_count: { type: 'number', description: '可选，重复次数。0表示不重复，-1表示无限重复' },
                    repeat_interval: { type: 'string', description: '可选，重复间隔时间，格式同delay' }
                },
                required: ['message', 'delay']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'cancel_reminder',
            description: '取消一个已设置的定时提醒',
            parameters: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: '要取消的提醒任务ID' }
                },
                required: ['task_id']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_reminders',
            description: '列出当前Agent设置的所有待执行的定时提醒',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_open',
            description: 'Open a webpage in the browser and extract its text content and interactive elements. Returns the page title, URL, visible text, and a list of all clickable/interactive elements with their CSS selectors. IMPORTANT: When you need to find specific content on a website (e.g. a particular product, article, or game), do NOT blindly click links. Instead: 1) Open the site, 2) Find the search input in the interactive elements list, 3) Use browser_type to enter your search query, 4) Use browser_click or browser_press_key to submit the search, 5) Then find the correct result.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'The absolute URL to navigate to.' },
                    tabId: { type: 'string', description: 'Optional ID for the browser tab, allowing you to manage multiple pages. Defaults to "default".' }
                },
                required: ['url']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_click',
            description: 'Click on an element identified by CSS selector. Returns the updated page state after click. ALWAYS check the returned page state to verify the click worked. WARNING: Do NOT guess or assume link destinations — always verify link text and href match your target before clicking.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'The CSS selector of the element to click. You can find this in the interactive elements list from browser_open.' },
                    tabId: { type: 'string', description: 'Optional ID for the browser tab. Defaults to "default".' }
                },
                required: ['selector']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_type',
            description: 'Type text into an input field (search box, form field, textarea, etc). Returns the updated page state. Use this to search for content on websites — find the search input selector from the interactive elements list, then type your query. After typing, you may need to use browser_press_key with "Enter" or browser_click on the search button to submit.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'The CSS selector of the input element.' },
                    text: { type: 'string', description: 'The text content to type into the field.' },
                    tabId: { type: 'string', description: 'Optional ID for the browser tab. Defaults to "default".' }
                },
                required: ['selector', 'text']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_press_key',
            description: 'Press a keyboard key (Enter, Escape). Returns the updated DOM state. Use this to submit forms if no submit button is available.',
            parameters: {
                type: 'object',
                properties: {
                    key: { type: 'string', description: 'The key name to press, e.g., "Enter", "Escape", "ArrowDown".' },
                    tabId: { type: 'string', description: 'Optional ID for the browser tab. Defaults to "default".' }
                },
                required: ['key']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_refresh',
            description: 'Refresh the current page. Returns the updated DOM state after refresh.',
            parameters: {
                type: 'object',
                properties: {
                    tabId: { type: 'string', description: 'Optional ID for the browser tab. Defaults to "default".' }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_screenshot',
            description: 'Take a screenshot of the current browser window. Returns a base64-encoded PNG image.',
            parameters: {
                type: 'object',
                properties: {
                    tabId: { type: 'string', description: 'Optional ID for the browser tab. Defaults to "default".' }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_scroll',
            description: 'Scroll the page up or down, or scroll to a specific element. Returns updated page state.',
            parameters: {
                type: 'object',
                properties: {
                    direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction.' },
                    amount: { type: 'number', description: 'Number of pixels to scroll. Default is 500.' },
                    selector: { type: 'string', description: 'Optional CSS selector to scroll to. If provided, direction and amount are ignored.' },
                    tabId: { type: 'string', description: 'Optional browser tab ID. Defaults to "default".' }
                },
                required: ['direction']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_wait',
            description: 'Wait for a specific element to appear on the page. Useful before interacting with dynamically loaded content.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of the element to wait for.' },
                    timeout: { type: 'number', description: 'Maximum time to wait in ms. Default is 10000.' },
                    tabId: { type: 'string', description: 'Optional browser tab ID. Defaults to "default".' }
                },
                required: ['selector']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_select',
            description: 'Select an option from a dropdown <select> element by its value.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of the <select> element.' },
                    value: { type: 'string', description: 'The value attribute of the option to select.' },
                    tabId: { type: 'string', description: 'Optional browser tab ID. Defaults to "default".' }
                },
                required: ['selector', 'value']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_hover',
            description: 'Hover over an element to trigger tooltips, dropdown menus, or other hover effects. Returns updated page state.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of the element to hover over.' },
                    tabId: { type: 'string', description: 'Optional browser tab ID. Defaults to "default".' }
                },
                required: ['selector']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_go_back',
            description: 'Navigate back in browser history. Returns the updated page state.',
            parameters: {
                type: 'object',
                properties: {
                    tabId: { type: 'string', description: 'Optional browser tab ID. Defaults to "default".' }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_go_forward',
            description: 'Navigate forward in browser history. Returns the updated page state.',
            parameters: {
                type: 'object',
                properties: {
                    tabId: { type: 'string', description: 'Optional browser tab ID. Defaults to "default".' }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_close_tab',
            description: 'Close a browser tab.',
            parameters: {
                type: 'object',
                properties: {
                    tabId: { type: 'string', description: 'ID of the tab to close. Defaults to "default".' }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'browser_eval_js',
            description: 'Execute JavaScript code on the current page and return the result. Use for advanced page interactions.',
            parameters: {
                type: 'object',
                properties: {
                    script: { type: 'string', description: 'The JavaScript code to execute in the browser context.' },
                    tabId: { type: 'string', description: 'Optional browser tab ID. Defaults to "default".' }
                },
                required: ['script']
            }
        }
    },
    // --- GUI Desktop Automation Tools ---
    {
        type: 'function',
        function: {
            name: 'gui_screenshot',
            description: 'Capture a screenshot of the entire desktop. The screenshot contains a red crosshair indicating the current physical mouse position. ⚠️ IMPORTANT WORKFLOW: First call gui_scan_screen to get exact element coordinates. Use gui_click_element to click by element name (most accurate). Use gui_screenshot only for visual verification of results, NOT for guessing coordinates. CRITICAL: Do not output the screenshot using markdown image syntax — it is displayed to the user automatically.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_click',
            description: 'Click the mouse at specific screen coordinates. MUST be preceded by gui_scan_screen or gui_screenshot_annotated to obtain accurate coordinates — do NOT guess from screenshots. Internally verifies the cursor reached the target (within 5px tolerance) before clicking.',
            parameters: {
                type: 'object',
                properties: {
                    x: { type: 'number', description: 'X coordinate in LOGICAL pixels as returned by gui_scan_screen or gui_screenshot_annotated.' },
                    y: { type: 'number', description: 'Y coordinate in LOGICAL pixels as returned by gui_scan_screen or gui_screenshot_annotated.' }
                },
                required: ['x', 'y']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_double_click',
            description: 'Double-click at specific screen coordinates. Use coordinates from gui_scan_screen, not from screenshot guesswork. Moves cursor then double-clicks.',
            parameters: {
                type: 'object',
                properties: {
                    x: { type: 'number', description: 'X coordinate in LOGICAL pixels (from gui_scan_screen).' },
                    y: { type: 'number', description: 'Y coordinate in LOGICAL pixels (from gui_scan_screen).' }
                },
                required: ['x', 'y']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_right_click',
            description: 'Right-click the mouse at specific screen coordinates to open context menus. Returns a screenshot after the action.',
            parameters: {
                type: 'object',
                properties: {
                    x: { type: 'number', description: 'X coordinate in pixels.' },
                    y: { type: 'number', description: 'Y coordinate in pixels.' }
                },
                required: ['x', 'y']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_type',
            description: 'Type text using the keyboard at the current cursor/focus position. Use gui_click first to focus the target input field, then use this tool to type text. Returns a screenshot after typing.',
            parameters: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: 'The text to type.' }
                },
                required: ['text']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_press_key',
            description: 'Press a keyboard key or key combination. Supports single keys (enter, tab, escape, f5) and combinations with + separator (ctrl+a, ctrl+c, ctrl+v, alt+f4, ctrl+shift+s, win+d). Returns a screenshot after the key press.',
            parameters: {
                type: 'object',
                properties: {
                    key: { type: 'string', description: 'Key name or combination. Examples: "enter", "tab", "escape", "ctrl+a", "ctrl+c", "ctrl+v", "alt+f4", "win+d", "ctrl+shift+s".' }
                },
                required: ['key']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_scroll',
            description: 'Scroll the mouse wheel at specified screen coordinates. Move the mouse to the position first, then scroll up or down. Returns a screenshot after scrolling.',
            parameters: {
                type: 'object',
                properties: {
                    x: { type: 'number', description: 'X coordinate to position mouse before scrolling.' },
                    y: { type: 'number', description: 'Y coordinate to position mouse before scrolling.' },
                    direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction.' },
                    amount: { type: 'number', description: 'Number of scroll clicks (default: 3).' }
                },
                required: ['x', 'y', 'direction']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_drag',
            description: 'Drag the mouse from one position to another (click and hold, move, release). Useful for moving windows, selecting text, drag-and-drop operations. Returns a screenshot after the drag.',
            parameters: {
                type: 'object',
                properties: {
                    from_x: { type: 'number', description: 'Starting X coordinate.' },
                    from_y: { type: 'number', description: 'Starting Y coordinate.' },
                    to_x: { type: 'number', description: 'Ending X coordinate.' },
                    to_y: { type: 'number', description: 'Ending Y coordinate.' }
                },
                required: ['from_x', 'from_y', 'to_x', 'to_y']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_get_cursor',
            description: 'Get the current mouse cursor position on screen. Returns exact X and Y coordinates of the cursor in screen logical pixels. Use this to track cursor position before and after movements, or to verify the cursor is where you expect it.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_move_mouse',
            description: 'Move the mouse cursor to specified coordinates WITHOUT clicking. Useful for hovering over elements (to reveal tooltips or dropdown menus) before clicking. Returns the new cursor position.',
            parameters: {
                type: 'object',
                properties: {
                    x: { type: 'number', description: 'Target X coordinate in screen pixels.' },
                    y: { type: 'number', description: 'Target Y coordinate in screen pixels.' }
                },
                required: ['x', 'y']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_get_windows',
            description: 'Get a list of all currently open visible windows on the desktop. Returns window titles and process names. Use this to identify which windows are open and to find the correct window title for gui_focus_window.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_scan_screen',
            description: 'Scan the screen using Windows UI Automation to identify all interactive elements (buttons, text fields, lists, checkboxes, etc.) with their semantic names and EXACT coordinates. Returns a numbered list (SoM-style). ALWAYS call this first before clicking anything. Use the returned element names with gui_click_element for guaranteed-accurate clicks, or use the returned x,y coordinates with gui_click. Optionally filter by window title.',
            parameters: {
                type: 'object',
                properties: {
                    window_title: { type: 'string', description: 'Optional: partial title of the window to filter scan to. If omitted, scans all visible windows.' }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_focus_window',
            description: 'Bring a specific window to the foreground and activate it. Use gui_get_windows first to find the exact window title, then use a partial match of the title here. Essential before performing GUI actions on a specific application.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Partial window title to match (case-insensitive). Example: "Chrome", "Notepad", "Explorer".' }
                },
                required: ['title']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_click_element',
            description: 'The PREFERRED click method. Finds an interactive element by name using gui_scan_screen, moves the cursor to it, verifies cursor arrival, then clicks. Much more accurate than gui_click with raw coordinates. Use this whenever gui_scan_screen returns elements.',
            parameters: {
                type: 'object',
                properties: {
                    element_name: { type: 'string', description: 'Name of the element to click, as shown in gui_scan_screen results (e.g. "确定", "搜索", "关闭").' },
                    window_title: { type: 'string', description: 'Optional: partial title of the window to scope the scan to.' },
                    button: { type: 'string', enum: ['left', 'right'], description: 'Which mouse button to use. Defaults to "left".' }
                },
                required: ['element_name']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_emergency_reset',
            description: 'Reset the GUI emergency stop state that was triggered by pressing ESC twice. After calling this, GUI operations can resume. Only call this when you have confirmed the situation is under control.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_screenshot_annotated',
            description: '🔬 BEST TOOL for GUI tasks. Takes a screenshot AND simultaneously scans all UI elements, then draws numbered colored bounding boxes (SoM markers) directly on the screenshot image. Returns: (1) the annotated image you can see, (2) a numbered element list with exact coordinates. Use gui_click_marker to click by marker number — no coordinate guessing ever needed. Use this instead of gui_screenshot + gui_scan_screen separately.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_click_marker',
            description: 'Click a UI element by its marker number shown in a gui_screenshot_annotated image. Pass the number you see in the colored circle badge on the screenshot. Internally moves cursor, verifies arrival, then clicks. The most precise and fool-proof way to click.',
            parameters: {
                type: 'object',
                properties: {
                    marker: { type: 'number', description: 'The marker number shown in the annotated screenshot (e.g. 3 for the element labeled ③).' },
                    button: { type: 'string', enum: ['left', 'right'], description: 'Which mouse button. Defaults to "left".' }
                },
                required: ['marker']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'gui_scan_desktop',
            description: '🗂️ Scan desktop file icons and get their EXACT coordinates. Desktop icons are invisible to gui_scan_screen (UIAutomation cannot see them). Use this tool FIRST when the user asks to open/double-click a file on the desktop. Returns a list of {name, path, x, y} objects where x,y are the center pixel coordinates ready for gui_double_click.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    }
];

// --- Tool Implementations ---

export function resolvePathAlias(filePath: string): string {
    // 支持 Windows 环境变量 (如 %USERPROFILE%, %DESKTOP%)
    if (filePath.includes('%')) {
        filePath = filePath.replace(/%([^%]+)%/g, (_: string, envVar: string) => {
            return process.env[envVar] || '';
        });
    }

    // 支持 ~ 作为用户主目录
    if (filePath.startsWith('~')) {
        const homeDir = process.env.USERPROFILE || process.env.HOME || '';
        if (homeDir) {
            filePath = path.join(homeDir, filePath.slice(1));
        }
    }

    // 支持常见的中文路径别名
    const desktopAliases = ['桌面', 'Desktop', 'desktop'];
    for (const alias of desktopAliases) {
        if (filePath === alias || filePath.startsWith(alias + path.sep) || filePath.startsWith(alias + '/') || filePath.startsWith(alias + '\\')) {
            const desktopPath = process.env.USERPROFILE
                ? path.join(process.env.USERPROFILE, 'Desktop')
                : null;
            if (desktopPath) {
                if (filePath === alias) {
                    filePath = desktopPath;
                } else {
                    filePath = path.join(desktopPath, filePath.slice(alias.length + 1));
                }
            }
            break;
        }
    }

    if (!path.isAbsolute(filePath)) {
        filePath = path.resolve(process.cwd(), filePath);
    }
    return filePath;
}


export type ToolOptions = { sandboxEnabled?: boolean; hardSandboxEnabled?: boolean; sessionId?: string; agentId?: string; conversationId?: string };
export type ToolHandler = (args: any, options?: ToolOptions) => Promise<string> | string;

export async function handleClawhubSearch(args: any, options?: ToolOptions): Promise<string> {
    const { keyword, category, page = 1, pageSize = 10 } = args;

    try {
        // Directly fetch from new ClawHub registry
        const url = new URL('https://clawhub.ai/api/v1/search');
        url.searchParams.append('q', keyword);

        const response = await fetch(url.toString(), {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            return `❌ 搜索技能失败: API返回状态码 ${response.status}`;
        }

        const data = await response.json();

        // The clawhub API format returns an object with a "results" array
        const results = data.results;
        if (!Array.isArray(results)) {
            return `❌ 搜索技能失败: 未知的API响应格式`;
        }

        if (results.length === 0) {
            return `没有找到与 "${keyword}" 相关的技能。`;
        }

        let resultStr = `找到 ${results.length} 个相关技能:\n`;
        resultStr += '='.repeat(80) + '\n';

        results.forEach((skill: any, index: number) => {
            resultStr += `${index + 1}. [${skill.slug}] ${skill.displayName || skill.slug}\n`;
            if (skill.summary) {
                resultStr += `   描述: ${skill.summary}\n`;
            }
            resultStr += '-'.repeat(80) + '\n';
        });

        resultStr += `\n你可以使用 \`clawhub_download\` 工具并提供技能的 slug (例如: \`${results[0]?.slug}\`) 来安装期望的技能。`;
        return resultStr;
    } catch (error) {
        return `搜索技能失败: ${(error as Error).message}`;
    }
}

export async function handleClawhubDownload(args: any, options?: ToolOptions): Promise<string> {
    const { skillId } = args;

    try {
        const workspaceDir = path.resolve(process.cwd(), '.qilin-claw', 'skills-workspace');
        await fs.mkdir(workspaceDir, { recursive: true });

        // Execute OpenClaw CLI natively
        const stdio = await execAsync(`npx -y clawhub@latest install ${skillId} --force --dir "${workspaceDir}"`, {
            cwd: process.cwd(),
            timeout: 60000
        });

        // Perform strict security scanning on the downloaded SKILL.md
        const skillDir = path.join(workspaceDir, skillId);
        const skillMdPath = path.join(skillDir, 'SKILL.md');

        try {
            const skillContent = await fs.readFile(skillMdPath, 'utf-8');
            const maliciousPatterns = [
                /rm\s+-r[f\s]*\//i,          // rm -rf /
                /mkfs/i,                     // Format disk
                /\/dev\/tcp\//i,             // Reverse shell
                /curl\s+.*\|\s*(bash|sh)/i,  // Curl to bash
                /wget\s+.*-O-\s*\|\s*(bash|sh)/i, // Wget to bash
                /nc\s+-e/i,                  // Netcat exec
                />\s*\/dev\/sd[a-z]/i        // Overwrite block device
            ];

            for (const pattern of maliciousPatterns) {
                if (pattern.test(skillContent)) {
                    // Delete the malicious malware immediately
                    await fs.rm(skillDir, { recursive: true, force: true });
                    return `🛑 安全拦截: 技能包 "${skillId}" 包含恶意或高危的后门代码，已自动销毁并拦截安装。`;
                }
            }
        } catch (readErr) {
            return `❌ 安全检查失败: 技能安装后无法读取 SKILL.md 配置文件 (${(readErr as Error).message})`;
        }

        // Reload skill engine to register new skills onto active context
        const { skillEngine } = await import('./skill-engine.js');
        skillEngine.reloadOpenClawSkills(workspaceDir);

        return `✅ 技能 "${skillId}" 安装成功并已自动通过反病毒安全校验！\n详细输出:\n${stdio.stdout}`;
    } catch (error) {
        return `下载技能失败: ${(error as Error).message}`;
    }
}

export async function handleClawhubList(args: any, options?: ToolOptions): Promise<string> {
    try {
        const { skillEngine } = await import('./skill-engine.js');
        const skills = skillEngine.getEnabledSkills();

        let result = `已启用的功能技能 (共 ${skills.length} 个):\n`;
        skills.forEach((s, idx) => {
            result += `${idx + 1}. ${s.name} (${s.id})\n`;
            result += `   ${s.description}\n`;
        });
        return result;
    } catch (error) {
        return `列出技能失败: ${(error as Error).message}`;
    }
}

export async function handleClawhubMcpSearch(args: any, options?: ToolOptions): Promise<string> {
    const { keyword, category, page = 1, pageSize = 10 } = args;
    try {
        // clawhub.ai MCP registry implementation
        const url = new URL('https://clawhub.ai/api/v1/search');
        url.searchParams.append('q', keyword);
        url.searchParams.append('type', 'mcp');

        const response = await fetch(url.toString(), {
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) { return `❌ 搜索MCP服务器失败: API返回状态码 ${response.status}`; }
        const data = await response.json();

        const results = data.results;
        if (!Array.isArray(results) || results.length === 0) {
            // The MCP category seems undocumented or untested currently on Clawhub.
            // We will fallback to returning empty and telling the LLM
            return `在 MCP 分类下未找到与 "${keyword}" 相关的长连接服务器。提示: 你可以尝试去除 MCP 限定，直接使用普通 clawhub_search 工具搜索。`;
        }

        let resultStr = `找到 ${results.length} 个相关 MCP 节点:\n`;
        resultStr += '='.repeat(80) + '\n';
        results.forEach((server: any, index: number) => {
            resultStr += `${index + 1}. [${server.slug}] ${server.displayName || server.slug}\n`;
            if (server.summary) resultStr += `   描述: ${server.summary}\n`;
        });

        return resultStr;
    } catch (error) {
        return `搜索MCP服务器失败: ${(error as Error).message}`;
    }
}

export async function handleClawhubMcpDownload(args: any, options?: ToolOptions): Promise<string> {
    const { serverId } = args;

    try {
        const workspaceDir = path.resolve(process.cwd(), '.qilin-claw', 'mcp-workspace');
        await fs.mkdir(workspaceDir, { recursive: true });

        // Since npx clawhub technically installs to wherever dir points, we can point it to an mcp-workspace
        const stdio = await execAsync(`npx -y clawhub@latest install ${serverId} --dir "${workspaceDir}"`, {
            cwd: process.cwd(),
            timeout: 60000
        });

        return `✅ MCP 服务器包 "${serverId}" 安装成功！\n此服务器需要重启进程以重新拉起 MCP 隧道。\n输出:\n${stdio.stdout}`;
    } catch (error) {
        return `下载MCP服务器失败: ${(error as Error).message}`;
    }
}

export async function handleClawhubMcpList(args: any, options?: ToolOptions): Promise<string> {
    try {
        const { mcpService } = await import('./mcp-service.js');
        const servers = mcpService.getAllServers();

        let result = `已配置的 MCP 服务器 (共 ${servers.length} 个):\n`;
        servers.forEach((s: any, idx: number) => {
            result += `${idx + 1}. ${s.name} (${s.id}) - 状态: ${s.status}\n`;
        });
        return result;
    } catch (error) {
        return `列出MCP服务器失败: ${(error as Error).message}`;
    }
}

export async function handleReadFile(args: any, options?: ToolOptions): Promise<string> {
    try {
        console.log('[read_file] args.path:', args.path);
        console.log('[read_file] process.cwd():', process.cwd());

        let filePath = resolvePathAlias(args.path);

        console.log('[read_file] Resolved filePath:', filePath);
        console.log('[read_file] File exists check:', await fs.access(filePath).then(() => 'yes').catch(() => 'no'));

        if (options?.sandboxEnabled && !filePath.startsWith(process.cwd())) {
            return `[Sandbox Security] Access Denied: You are not allowed to read files outside the project directory (${process.cwd()}).`;
        }

        const content = await fs.readFile(filePath, 'utf-8');
        return content;
    } catch (fsError: any) {
        console.error('[read_file] Full error:', fsError);
        console.error('[read_file] Error code:', fsError.code);
        console.error('[read_file] Error message:', fsError.message);

        // 如果文件系统读取失败，尝试从数据库读取
        if (fsError.code === 'ENOENT') {
            // 从数据库中查找文件（需要时才创建连接）
            let doc: any = null;
            try {
                const dbPath = path.resolve(process.cwd(), '.qilin-claw', 'qilin-claw.db');
                const db = new Database(dbPath, { readonly: true });
                const fileName = path.basename(args.path);
                doc = db.prepare('SELECT content FROM knowledge_documents WHERE original_name = ?').get(fileName) as any;
                db.close();
            } catch (dbError) {
                console.error('[read_file] Database lookup failed:', dbError);
            }

            if (doc && doc.content) {
                return doc.content;
            } else {
                return `Error: File not found in filesystem or database: ${args.path}\nResolved path: ${args.path}\nError: ${fsError.message}`;
            }
        } else {
            return `Error reading file: ${fsError.message}\nError code: ${fsError.code}\nResolved path: ${args.path}`;
        }
    }
}

export async function handleWriteFile(args: any, options?: ToolOptions): Promise<string> {
    console.log('[write_file] args.path:', args.path);
    console.log('[write_file] process.cwd():', process.cwd());

    let filePath = args.path;

    // 支持 Windows 环境变量 (如 %USERPROFILE%, %DESKTOP%)
    if (filePath.includes('%')) {
        filePath = filePath.replace(/%([^%]+)%/g, (_: string, envVar: string) => {
            return process.env[envVar] || '';
        });
    }

    // 支持 ~ 作为用户主目录
    if (filePath.startsWith('~')) {
        const homeDir = process.env.USERPROFILE || process.env.HOME || '';
        if (homeDir) {
            filePath = path.join(homeDir, filePath.slice(1));
        }
    }

    // 支持常见的中文路径别名
    const desktopAliases = ['桌面', 'Desktop', 'desktop'];
    for (const alias of desktopAliases) {
        if (filePath === alias || filePath.startsWith(alias + path.sep) || filePath.startsWith(alias + '/') || filePath.startsWith(alias + '\\')) {
            const desktopPath = process.env.USERPROFILE
                ? path.join(process.env.USERPROFILE, 'Desktop')
                : null;
            if (desktopPath) {
                if (filePath === alias) {
                    filePath = desktopPath;
                } else {
                    filePath = path.join(desktopPath, filePath.slice(alias.length + 1));
                }
            }
            break;
        }
    }

    if (!path.isAbsolute(filePath)) {
        filePath = path.resolve(process.cwd(), filePath);
    }

    console.log('[write_file] Resolved filePath:', filePath);

    if (options?.sandboxEnabled && !filePath.startsWith(process.cwd())) {
        return `[Sandbox Security] Access Denied: You are not allowed to write files outside the project directory.`;
    }

    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        // Create backup before writing (with conversationId for recall rollback)
        try { await fileSafetyService.createBackup(filePath, 'write_file', options?.conversationId); } catch { /* file may not exist yet */ }
        await fs.writeFile(filePath, args.content, 'utf-8');
        console.log('[write_file] File written successfully');
        return `Successfully wrote to ${filePath}`;
    } catch (writeErr: any) {
        console.error('[write_file] Error:', writeErr);
        console.error('[write_file] Error code:', writeErr.code);
        return `Failed to write file: ${writeErr.message}\nError code: ${writeErr.code}\nResolved path: ${filePath}`;
    }
}

export async function handleEditFile(args: any, options?: ToolOptions): Promise<string> {
    console.log('[edit_file] args.path:', args.path);
    console.log('[edit_file] process.cwd():', process.cwd());

    let filePath = args.path;

    // 支持 Windows 环境变量 (如 %USERPROFILE%, %DESKTOP%)
    if (filePath.includes('%')) {
        filePath = filePath.replace(/%([^%]+)%/g, (_: string, envVar: string) => {
            return process.env[envVar] || '';
        });
    }

    // 支持 ~ 作为用户主目录
    if (filePath.startsWith('~')) {
        const homeDir = process.env.USERPROFILE || process.env.HOME || '';
        if (homeDir) {
            filePath = path.join(homeDir, filePath.slice(1));
        }
    }

    // 支持常见的中文路径别名
    const desktopAliases = ['桌面', 'Desktop', 'desktop'];
    for (const alias of desktopAliases) {
        if (filePath === alias || filePath.startsWith(alias + path.sep) || filePath.startsWith(alias + '/') || filePath.startsWith(alias + '\\')) {
            const desktopPath = process.env.USERPROFILE
                ? path.join(process.env.USERPROFILE, 'Desktop')
                : null;
            if (desktopPath) {
                if (filePath === alias) {
                    filePath = desktopPath;
                } else {
                    filePath = path.join(desktopPath, filePath.slice(alias.length + 1));
                }
            }
            break;
        }
    }

    if (!path.isAbsolute(filePath)) {
        filePath = path.resolve(process.cwd(), filePath);
    }

    console.log('[edit_file] Resolved filePath:', filePath);

    if (options?.sandboxEnabled && !filePath.startsWith(process.cwd())) {
        return `[Sandbox Security] Access Denied: You are not allowed to edit files outside the project directory.`;
    }

    try {
        const content = await fs.readFile(filePath, 'utf-8');
        if (!content.includes(args.old_string)) {
            return `Error: The old_string provided was not found in the file exactly as written.`;
        }
        // Create backup before editing (with conversationId for recall rollback)
        await fileSafetyService.createBackup(filePath, 'edit_file', options?.conversationId);
        const newContent = content.replace(args.old_string, args.new_string);
        await fs.writeFile(filePath, newContent, 'utf-8');
        return `Successfully edited ${filePath}`;
    } catch (editErr: any) {
        console.error('[edit_file] Error:', editErr);
        console.error('[edit_file] Error code:', editErr.code);
        return `Error editing file: ${editErr.message}\nError code: ${editErr.code}\nResolved path: ${filePath}`;
    }
}

export async function handleDeleteFile(args: any, options?: ToolOptions): Promise<string> {
    console.log('[delete_file] args.path:', args.path);
    console.log('[delete_file] process.cwd():', process.cwd());

    let filePath = args.path;

    // 支持 Windows 环境变量 (如 %USERPROFILE%, %DESKTOP%)
    if (filePath.includes('%')) {
        filePath = filePath.replace(/%([^%]+)%/g, (_: string, envVar: string) => {
            return process.env[envVar] || '';
        });
    }

    // 支持 ~ 作为用户主目录
    if (filePath.startsWith('~')) {
        const homeDir = process.env.USERPROFILE || process.env.HOME || '';
        if (homeDir) {
            filePath = path.join(homeDir, filePath.slice(1));
        }
    }

    // 支持常见的中文路径别名
    const desktopAliases = ['桌面', 'Desktop', 'desktop'];
    for (const alias of desktopAliases) {
        if (filePath === alias || filePath.startsWith(alias + path.sep) || filePath.startsWith(alias + '/') || filePath.startsWith(alias + '\\')) {
            const desktopPath = process.env.USERPROFILE
                ? path.join(process.env.USERPROFILE, 'Desktop')
                : null;
            if (desktopPath) {
                if (filePath === alias) {
                    filePath = desktopPath;
                } else {
                    filePath = path.join(desktopPath, filePath.slice(alias.length + 1));
                }
            }
            break;
        }
    }

    if (!path.isAbsolute(filePath)) {
        filePath = path.resolve(process.cwd(), filePath);
    }

    console.log('[delete_file] Resolved filePath:', filePath);

    if (options?.sandboxEnabled && !filePath.startsWith(process.cwd())) {
        return `[Sandbox Security] Access Denied: You are not allowed to delete files outside the project directory.`;
    }

    try {
        const recursive = args.recursive !== undefined ? args.recursive : true;
        const stats = await fs.stat(filePath);

        if (stats.isDirectory()) {
            await fs.rm(filePath, { recursive, force: true });
            console.log('[delete_file] Directory deleted successfully');
            return `Successfully deleted directory: ${filePath}`;
        } else {
            // Create backup before deleting (with conversationId for recall rollback)
            await fileSafetyService.createBackup(filePath, 'delete_file', options?.conversationId);
            await fs.unlink(filePath);
            console.log('[delete_file] File deleted successfully');
            return `Successfully deleted file: ${filePath}`;
        }
    } catch (deleteErr: any) {
        console.error('[delete_file] Error:', deleteErr);
        console.error('[delete_file] Error code:', deleteErr.code);
        return `Failed to delete file: ${deleteErr.message}\nError code: ${deleteErr.code}\nResolved path: ${filePath}`;
    }
}

export async function handlePlanAndExecute(args: any, options?: ToolOptions): Promise<string> {
    const { problem, plan } = args;
    let result = `# 多步骤问题解决计划
    
    ## 问题
    ${problem}
    
    ## 执行计划
    `;

    for (let i = 0; i < plan.length; i++) {
        result += `${i + 1}. ${plan[i]}
    `;
    }

    result += `
    ## 执行结果
    计划已创建，开始执行各个步骤。
    
    注意：此工具仅用于规划和跟踪多步骤任务，具体的执行操作需要使用其他专门的工具（如read_file、write_file等）来完成。
    `;

    return result;
}

export async function handleExecCmd(args: any, options?: ToolOptions): Promise<string> {
    // ── Runtime command safety check (applies to ALL execution modes) ──
    const { checkCommandSafety, formatBlockedMessage, sanitizeCommandOutput } = await import('../safety/command-safety.js');
    const safetyCheck = checkCommandSafety(args.command);
    if (safetyCheck.blocked) {
        console.warn(`[Security] BLOCKED dangerous command: [${safetyCheck.category}] ${safetyCheck.description} — "${args.command.substring(0, 80)}"`);
        return formatBlockedMessage(safetyCheck.category!, safetyCheck.description!, args.command);
    }

    if (options?.hardSandboxEnabled) {
        if (!options.agentId) {
            return '[Sandbox Error] No agent ID provided for Hard Sandbox execution.';
        }
        try {
            const { stdout, stderr } = await (await getDockerSandboxService()).runInSandbox(args.command, options.agentId);
            let result = '';
            if (stdout) result += `STDOUT:\n${sanitizeCommandOutput(stdout)}\n`;
            if (stderr) result += `STDERR:\n${sanitizeCommandOutput(stderr)}\n`;
            return result || 'Command executed successfully in Docker sandbox with no output.';
        } catch (error: any) {
            return `[Sandbox Error] Command execution failed in Docker sandbox: ${error.message}`;
        }
    }

    if (options?.sandboxEnabled) {
        return `[Sandbox Security] Execution Denied: In soft sandbox mode, you are strictly forbidden from running terminal commands automatically on the host. Please reply to the user with the exact command you wanted to run, and ask them to manually execute it.`;
    }
    const cwd = args.cwd ? path.resolve(process.cwd(), args.cwd) : process.cwd();
    const isWindows = process.platform === 'win32';
    // Force UTF-8 code page on Windows CMD to prevent GBK encoding garble for Chinese characters
    const finalCommand = isWindows ? `chcp 65001 >nul & ${args.command}` : args.command;
    const { stdout, stderr } = await execAsync(finalCommand, { cwd });
    let result = '';
    if (stdout) result += `STDOUT:\n${stdout}\n`;
    if (stderr) result += `STDERR:\n${stderr}\n`;
    return result || 'Command executed successfully with no output.';
}

export async function handleWebSearch(args: any, options?: ToolOptions): Promise<string> {
    // simple fetch against DDG html
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

    try {
        const resp = await fetch(url, { headers });
        const text = await resp.text();

        // rudimentary parsing of DDG HTML results
        const results: string[] = [];
        const snippetRegex = /<a class="result__snippet[^>]*>(.*?)<\/a>/g;
        let match;
        while ((match = snippetRegex.exec(text)) !== null && results.length < 5) {
            // strip bold tags
            const cleanText = match[1].replace(/<\/?b>/g, '').trim();
            results.push(`- ${cleanText}`);
        }

        if (results.length > 0) {
            return `Search results for "${args.query}":\n` + results.join('\n');
        }
        return `No clear results found for "${args.query}".`;
    } catch (e: any) {
        return `Web search failed: ${e.message}`;
    }
}

export async function handleWebFetch(args: any, options?: ToolOptions): Promise<string> {
    try {
        const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
        const resp = await fetch(args.url, { headers });
        if (!resp.ok) return `HTTP Error: ${resp.status} ${resp.statusText}`;
        const text = await resp.text();

        let cleanText = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '\n');
        cleanText = cleanText.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '\n');
        cleanText = cleanText.replace(/<[^>]+>/g, ' ');
        cleanText = cleanText.replace(/\s+/g, ' ').trim();

        return `Content from ${args.url}:\n\n` + cleanText.substring(0, 15000) + (cleanText.length > 15000 ? '\n...[truncated]' : '');
    } catch (e: any) {
        return `Web fetch failed: ${e.message}`;
    }
}

export async function handleManageProcess(args: any, options?: ToolOptions): Promise<string> {
    if (options?.sandboxEnabled && (args.action === 'start' || args.action === 'stop')) {
        return `[Sandbox Security] Execution Denied: In sandbox mode, you cannot start or stop background processes.`;
    }
    if (args.action === 'list') {
        if (backgroundProcesses.size === 0) return 'No background processes running.';
        let list = 'Running Background Processes:\n';
        for (const [pid, proc] of backgroundProcesses.entries()) {
            list += `- ID: ${pid} | Command: ${proc.command}\n`;
        }
        return list;
    } else if (args.action === 'start') {
        if (!args.command) return 'Error: command is required to start a process.';
        const child = exec(args.command);
        const pidStr = `proc_${processIdCounter++}`;
        backgroundProcesses.set(pidStr, { process: child, command: args.command });
        child.on('exit', () => backgroundProcesses.delete(pidStr));
        return `Started background process ${pidStr} for command: ${args.command}`;
    } else if (args.action === 'stop') {
        if (!args.id) return 'Error: id is required to stop a process.';
        const procObj = backgroundProcesses.get(args.id);
        if (!procObj) return `Error: Process ID ${args.id} not found.`;
        procObj.process.kill();
        backgroundProcesses.delete(args.id);
        return `Stopped process ${args.id}`;
    }
    return 'Error: Invalid action. Use start, stop, or list.';
}

export async function handleSendMessage(args: any, options?: ToolOptions): Promise<string> {
    const { content, type = 'status' } = args;
    const typeEmojis = {
        progress: '🔄',
        status: '📢',
        question: '❓',
        result: '✅'
    };
    const emoji = typeEmojis[type as keyof typeof typeEmojis] || '📢';
    const formattedMessage = `${emoji} [${type.toUpperCase()}] ${content}`;

    if (options?.sessionId) {
        try {
            const { gatewayService } = await import('./gateway.js');
            gatewayService.sendMessage(options.sessionId, type, content);
        } catch (error) {
            console.error('[send_message] Failed to send via gateway:', error);
        }
    }

    return formattedMessage;
}

export async function handleSetReminder(args: any, options?: ToolOptions): Promise<string> {
    const { message, delay, repeat_count, repeat_interval } = args;
    const { schedulerService } = await import('./scheduler.js');

    const parseDelay = (str: string): number => {
        if (!str) return 0;
        str = str.trim();
        // Pure number = seconds
        if (/^\d+$/.test(str)) return parseInt(str) * 1000;
        // Chinese formats
        let match = str.match(/(\d+)\s*秒/);
        if (match) return parseInt(match[1]) * 1000;
        match = str.match(/(\d+)\s*分/);
        if (match) return parseInt(match[1]) * 60 * 1000;
        match = str.match(/(\d+)\s*小时/);
        if (match) return parseInt(match[1]) * 3600 * 1000;
        match = str.match(/(\d+)\s*天/);
        if (match) return parseInt(match[1]) * 86400 * 1000;
        // English formats
        match = str.match(/(\d+)\s*s/i);
        if (match) return parseInt(match[1]) * 1000;
        match = str.match(/(\d+)\s*m/i);
        if (match) return parseInt(match[1]) * 60 * 1000;
        match = str.match(/(\d+)\s*h/i);
        if (match) return parseInt(match[1]) * 3600 * 1000;
        match = str.match(/(\d+)\s*d/i);
        if (match) return parseInt(match[1]) * 86400 * 1000;
        return 0;
    };

    const delayMs = parseDelay(delay);
    if (delayMs <= 0) {
        return `错误：无法解析时间 "${delay}"。支持格式："5分钟"、"1小时"、"30秒"、"2h"、"10m"、"30s" 或纯数字(秒)`;
    }

    const agentId = options?.agentId || '';
    const conversationId = options?.conversationId || '';

    const repeatOpts = (repeat_count !== undefined && repeat_interval)
        ? { intervalMs: parseDelay(repeat_interval), count: repeat_count }
        : undefined;

    const task = schedulerService.addTask({
        agentId,
        conversationId,
        message,
        delayMs,
        repeat: repeatOpts,
    });

    const triggerTime = new Date(task.triggerAt).toLocaleString('zh-CN');
    let result = `✅ 提醒已设置！\n- 任务ID: ${task.id}\n- 提醒内容: ${message}\n- 将在 ${Math.round(delayMs / 1000)} 秒后 (${triggerTime}) 触发`;
    if (repeatOpts) {
        result += `\n- 重复: 每 ${Math.round(repeatOpts.intervalMs / 1000)} 秒, ${repeatOpts.count === -1 ? '无限循环' : `共 ${repeatOpts.count} 次`}`;
    }
    return result;
}

export async function handleCancelReminder(args: any, options?: ToolOptions): Promise<string> {
    const { task_id } = args;
    const { schedulerService } = await import('./scheduler.js');
    const success = schedulerService.cancelTask(task_id);
    return success ? `✅ 提醒 ${task_id} 已取消` : `❌ 未找到待执行的提醒 ${task_id}`;
}

export async function handleListReminders(args: any, options?: ToolOptions): Promise<string> {
    const { schedulerService } = await import('./scheduler.js');
    const agentId = options?.agentId || '';
    const tasks = agentId
        ? schedulerService.getTasksByAgent(agentId).filter(t => t.status === 'pending')
        : schedulerService.getPendingTasks();
    if (tasks.length === 0) return '当前没有待执行的定时提醒。';
    let result = `当前有 ${tasks.length} 个待执行提醒:\n`;
    for (const t of tasks) {
        const triggerTime = new Date(t.triggerAt).toLocaleString('zh-CN');
        result += `- [${t.id}] "${t.message}" → ${triggerTime}\n`;
    }
    return result;
}

// --- Browser Extension Bridge (lazy-loaded) ---
let _extensionBridge: any = null;
async function getExtensionBridge() {
    if (!_extensionBridge) {
        const mod = await import('./extension-bridge.js');
        _extensionBridge = mod.extensionBridge;
    }
    return _extensionBridge;
}

export async function handleBrowserOpen(args: any): Promise<string> {
    const { url, tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.openAndExtract(url, tabId);
    }
    return await (await getBrowserService()).openAndExtract(url, tabId);
}

export async function handleBrowserClick(args: any): Promise<string> {
    const { selector, tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.clickElement(selector, tabId);
    }
    return await (await getBrowserService()).clickElement(selector, tabId);
}

export async function handleBrowserType(args: any): Promise<string> {
    const { selector, text, tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.typeText(selector, text, tabId);
    }
    return await (await getBrowserService()).typeText(selector, text, tabId);
}

export async function handleBrowserPressKey(args: any): Promise<string> {
    const { key, tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.pressKey(key, tabId);
    }
    return await (await getBrowserService()).pressKey(key, tabId);
}

export async function handleBrowserRefresh(args: any): Promise<string> {
    const { tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.refreshPage(tabId);
    }
    return await (await getBrowserService()).refreshPage(tabId);
}

export async function handleBrowserScreenshot(args: any): Promise<string> {
    const { tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.takeScreenshot(tabId);
    }
    return await (await getBrowserService()).takeScreenshot(tabId);
}

export async function handleBrowserScroll(args: any): Promise<string> {
    const { direction, amount, selector, tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.scrollPage(direction, amount, selector, tabId);
    }
    return await (await getBrowserService()).scrollPage(direction, amount, selector, tabId);
}

export async function handleBrowserWait(args: any): Promise<string> {
    const { selector, timeout, tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.waitForElement(selector, timeout, tabId);
    }
    return await (await getBrowserService()).waitForElement(selector, timeout, tabId);
}

export async function handleBrowserSelect(args: any): Promise<string> {
    const { selector, value, tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.selectOption(selector, value, tabId);
    }
    return await (await getBrowserService()).selectOption(selector, value, tabId);
}

export async function handleBrowserHover(args: any): Promise<string> {
    const { selector, tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.hoverElement(selector, tabId);
    }
    return await (await getBrowserService()).hoverElement(selector, tabId);
}

export async function handleBrowserGoBack(args: any): Promise<string> {
    const { tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.goBack(tabId);
    }
    return await (await getBrowserService()).goBack(tabId);
}

export async function handleBrowserGoForward(args: any): Promise<string> {
    const { tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.goForward(tabId);
    }
    return await (await getBrowserService()).goForward(tabId);
}

export async function handleBrowserCloseTab(args: any): Promise<string> {
    const { tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.closeTab(tabId);
    }
    return await (await getBrowserService()).closeTab(tabId);
}

export async function handleBrowserEvalJS(args: any): Promise<string> {
    const { script, tabId } = args;
    const bridge = await getExtensionBridge();
    if (bridge.isConnected()) {
        return await bridge.evaluateJS(script, tabId);
    }
    return await (await getBrowserService()).evaluateJS(script, tabId);
}

// --- GUI Desktop Automation Tool Handlers ---

/**
 * Special marker prefix for GUI screenshot results.
 * The chat orchestrator detects this to inject the screenshot as an image_url content part
 * so the multimodal model can "see" the screen.
 */
const GUI_SCREENSHOT_PREFIX = '[GUI_SCREENSHOT]';

/**
 * Format a screenshot result with resolution metadata for the agent.
 * Includes coordinate mapping instructions when image resolution differs from screen resolution.
 */
function formatScreenshotResult(result: any, prefix?: string): string {
    const lines: string[] = [];
    if (prefix) lines.push(prefix);

    // Include resolution info so agent can map coordinates correctly
    if (result.imageWidth && result.screenWidth) {
        const scaleX = result.screenWidth / result.imageWidth;
        const scaleY = result.screenHeight / result.imageHeight;
        lines.push(`[屏幕信息] 系统坐标: ${result.screenWidth}x${result.screenHeight} | 截图像素: ${result.imageWidth}x${result.imageHeight} | DPI缩放: ${result.scaleFactor}`);
        if (Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01) {
            lines.push(`⚠️ 坐标换算: 请将截图中看到的像素位置 × ${scaleX.toFixed(3)}(X) / × ${scaleY.toFixed(3)}(Y) 转换为系统坐标`);
        } else {
            lines.push(`✅ 截图分辨率与系统坐标一致，无需换算`);
        }
    }

    // Show cursor position if available (red crosshair already drawn on image)
    if (result.cursorX !== undefined && result.cursorY !== undefined) {
        lines.push(`🖱️ 当前鼠标位置: (${result.cursorX}, ${result.cursorY}) — 已在截图中用红色十字标注`);
    }

    lines.push(`${GUI_SCREENSHOT_PREFIX}${result.dataUrl}`);
    return lines.join('\n');
}

// Helper: check if GUI emergency stop is active
async function checkGuiEmergencyAbort(): Promise<string | null> {
    const gui = await getGuiService();
    if (gui.isEmergencyAborted()) {
        return '[🚨 GUI紧急中止] 用户已双击ESC触发紧急停止，当前所有操作已被强制中断。';
    }
    return null;
}

export async function handleGuiScreenshot(args: any): Promise<string> {
    const blocked = await checkGuiEmergencyAbort();
    if (blocked) return blocked;
    try {
        const gui = await getGuiService();
        const result = await gui.takeScreenshot();
        return formatScreenshotResult(result, '[OK] 桌面截图已捕获');
    } catch (error: any) {
        return `[ERROR] 桌面截图失败: ${error.message}`;
    }
}

export async function handleGuiClick(args: any): Promise<string> {
    const blocked = await checkGuiEmergencyAbort();
    if (blocked) return blocked;
    try {
        const gui = await getGuiService();
        // Move first, then verify cursor arrived before clicking
        await gui.moveMouse(args.x, args.y);
        await new Promise(r => setTimeout(r, 120));
        const pos = await gui.getCursorPosition();
        const dx = Math.abs(pos.x - args.x);
        const dy = Math.abs(pos.y - args.y);
        if (dx > 15 || dy > 15) {
            return `[ERROR] 光标验证失败: 目标(${args.x},${args.y}) 但光标实际在(${pos.x},${pos.y})，已中止点击。请先调用 gui_scan_screen 获取确切坐标。`;
        }
        await gui.clickMouse(args.x, args.y, 'left');
        return `[OK] 已点击坐标 (${args.x},${args.y})。调用 gui_screenshot 验证结果。`;
    } catch (error: any) {
        return `[ERROR] 点击失败: ${error.message}`;
    }
}

export async function handleGuiDoubleClick(args: any): Promise<string> {
    const blocked = await checkGuiEmergencyAbort();
    if (blocked) return blocked;
    try {
        const gui = await getGuiService();
        await gui.moveMouse(args.x, args.y);
        await new Promise(r => setTimeout(r, 120));
        const pos = await gui.getCursorPosition();
        const dx = Math.abs(pos.x - args.x);
        const dy = Math.abs(pos.y - args.y);
        if (dx > 15 || dy > 15) {
            return `[ERROR] 光标验证失败: 目标(${args.x},${args.y}) 但光标实际在(${pos.x},${pos.y})，已中止双击。`;
        }
        await gui.doubleClick(args.x, args.y);
        return `[OK] 已双击坐标 (${args.x},${args.y})。调用 gui_screenshot 验证结果。`;
    } catch (error: any) {
        return `[ERROR] 双击失败: ${error.message}`;
    }
}

export async function handleGuiRightClick(args: any): Promise<string> {
    const blocked = await checkGuiEmergencyAbort();
    if (blocked) return blocked;
    try {
        const gui = await getGuiService();
        await gui.moveMouse(args.x, args.y);
        await new Promise(r => setTimeout(r, 120));
        const pos = await gui.getCursorPosition();
        const dx = Math.abs(pos.x - args.x);
        const dy = Math.abs(pos.y - args.y);
        if (dx > 15 || dy > 15) {
            return `[ERROR] 光标验证失败: 目标(${args.x},${args.y}) 但光标实际在(${pos.x},${pos.y})，已中止右键。`;
        }
        await gui.clickMouse(args.x, args.y, 'right');
        return `[OK] 已右键坐标 (${args.x},${args.y})。调用 gui_screenshot 验证结果。`;
    } catch (error: any) {
        return `[ERROR] 右键失败: ${error.message}`;
    }
}

export async function handleGuiType(args: any): Promise<string> {
    const blocked = await checkGuiEmergencyAbort();
    if (blocked) return blocked;
    try {
        const gui = await getGuiService();
        await gui.typeText(args.text);
        const preview = args.text.substring(0, 50) + (args.text.length > 50 ? '...' : '');
        return `[OK] 已输入文本: "${preview}"。调用 gui_screenshot 验证结果。`;
    } catch (error: any) {
        return `[ERROR] 输入文本失败: ${error.message}`;
    }
}

export async function handleGuiPressKey(args: any): Promise<string> {
    const blocked = await checkGuiEmergencyAbort();
    if (blocked) return blocked;
    try {
        const gui = await getGuiService();
        await gui.pressKey(args.key);
        return `[OK] 已按下按键: ${args.key}。调用 gui_screenshot 验证结果。`;
    } catch (error: any) {
        return `[ERROR] 按键失败: ${error.message}`;
    }
}

export async function handleGuiScroll(args: any): Promise<string> {
    const blocked = await checkGuiEmergencyAbort();
    if (blocked) return blocked;
    try {
        const gui = await getGuiService();
        await gui.scrollMouse(args.x, args.y, args.direction, args.amount);
        const dir = args.direction === 'up' ? '上' : '下';
        return `[OK] 已在 (${args.x},${args.y}) 向${dir}滚动${args.amount || 3}格。调用 gui_screenshot 验证结果。`;
    } catch (error: any) {
        return `[ERROR] 滚动失败: ${error.message}`;
    }
}

export async function handleGuiDrag(args: any): Promise<string> {
    const blocked = await checkGuiEmergencyAbort();
    if (blocked) return blocked;
    try {
        const gui = await getGuiService();
        await gui.dragMouse(args.from_x, args.from_y, args.to_x, args.to_y);
        return `[OK] 已从 (${args.from_x},${args.from_y}) 拖拽到 (${args.to_x},${args.to_y})。调用 gui_screenshot 验证结果。`;
    } catch (error: any) {
        return `[ERROR] 拖拽失败: ${error.message}`;
    }
}

export async function handleSendFile(args: any, options?: ToolOptions): Promise<string> {
    try {
        let filePath = path.resolve(process.cwd(), args.path);

        // Handle common aliases or ENV vars like handleReadFile does
        if (filePath.includes('%')) {
            filePath = filePath.replace(/%([^%]+)%/g, (_: string, envVar: string) => process.env[envVar] || '');
        }
        if (filePath.startsWith('~')) {
            const homeDir = process.env.USERPROFILE || process.env.HOME || '';
            if (homeDir) filePath = path.join(homeDir, filePath.slice(1));
        }

        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
            return `[ERROR] Cannot send a directory. Please provide a path to a file.`;
        }

        const fileName = path.basename(filePath);
        const ext = path.extname(fileName).toLowerCase();
        const mimeTypes: Record<string, string> = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
            '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv',
            '.json': 'application/json', '.md': 'text/markdown', '.html': 'text/html',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            '.mp4': 'video/mp4', '.mp3': 'audio/mpeg'
        };
        const mimeType = mimeTypes[ext] || 'application/octet-stream';

        const fileUrl = `/api/files/download?path=${encodeURIComponent(filePath)}`;

        return `[SEND_FILE]${fileUrl}|${fileName}|${mimeType}\n✅ 已成功将文件发送给用户: ${fileName}`;
    } catch (e: any) {
        return `[ERROR] Failed to send file: ${e.message}`;
    }
}

export const toolHandlers: Record<string, ToolHandler> = {
    'clawhub_search': handleClawhubSearch,
    'clawhub_download': handleClawhubDownload,
    'clawhub_list': handleClawhubList,
    'clawhub_mcp_search': handleClawhubMcpSearch,
    'clawhub_mcp_download': handleClawhubMcpDownload,
    'clawhub_mcp_list': handleClawhubMcpList,
    'read_file': handleReadFile,
    'write_file': handleWriteFile,
    'edit_file': handleEditFile,
    'delete_file': handleDeleteFile,
    'send_file': handleSendFile,
    'plan_and_execute': handlePlanAndExecute,
    'exec_cmd': handleExecCmd,
    'web_search': handleWebSearch,
    'web_fetch': handleWebFetch,
    'manage_process': handleManageProcess,
    'send_message': handleSendMessage,
    'set_reminder': handleSetReminder,
    'cancel_reminder': handleCancelReminder,
    'list_reminders': handleListReminders,
    'browser_open': handleBrowserOpen,
    'browser_click': handleBrowserClick,
    'browser_type': handleBrowserType,
    'browser_press_key': handleBrowserPressKey,
    'browser_refresh': handleBrowserRefresh,
    'browser_screenshot': handleBrowserScreenshot,
    'browser_scroll': handleBrowserScroll,
    'browser_wait': handleBrowserWait,
    'browser_select': handleBrowserSelect,
    'browser_hover': handleBrowserHover,
    'browser_go_back': handleBrowserGoBack,
    'browser_go_forward': handleBrowserGoForward,
    'browser_close_tab': handleBrowserCloseTab,
    'browser_eval_js': handleBrowserEvalJS,
    'gui_screenshot': handleGuiScreenshot,
    'gui_click': handleGuiClick,
    'gui_double_click': handleGuiDoubleClick,
    'gui_right_click': handleGuiRightClick,
    'gui_type': handleGuiType,
    'gui_press_key': handleGuiPressKey,
    'gui_scroll': handleGuiScroll,
    'gui_drag': handleGuiDrag,
    'gui_get_cursor': handleGuiGetCursor,
    'gui_move_mouse': handleGuiMoveMouse,
    'gui_get_windows': handleGuiGetWindows,
    'gui_scan_screen': handleGuiScanScreen,
    'gui_focus_window': handleGuiFocusWindow,
    'gui_click_element': handleGuiClickElement,
    'gui_emergency_reset': handleGuiEmergencyReset,
    'gui_screenshot_annotated': handleGuiScreenshotAnnotated,
    'gui_click_marker': handleGuiClickMarker,
    'gui_scan_desktop': handleGuiScanDesktop,
};

export async function handleGuiGetCursor(args: any): Promise<string> {
    try {
        const gui = await getGuiService();
        const pos = await gui.getCursorPosition();
        return `[OK] 当前鼠标坐标: X=${pos.x}, Y=${pos.y}`;
    } catch (error: any) {
        return `[ERROR] 获取鼠标坐标失败: ${error.message}`;
    }
}

export async function handleGuiScanDesktop(args: any): Promise<string> {
    try {
        const gui = await getGuiService();
        const icons = await gui.scanDesktopIcons();
        if (icons.length === 0) {
            return '[OK] 桌面上未找到图标（可能被其他窗口覆盖或无文件）。';
        }
        const lines = icons.map((ic: { name: string; path: string; x: number; y: number; w: number; h: number }, i: number) =>
            `${i + 1}. "${ic.name}" - 中心坐标: (${ic.x}, ${ic.y}) 大小: ${ic.w}x${ic.h}`
        );
        return `[桌面图标列表] 共 ${icons.length} 个图标:\n${lines.join('\n')}\n\n💡 使用 gui_double_click(x, y) 双击打开，坐标已经是精确的鼠标点击位置。`;
    } catch (error: any) {
        return `[ERROR] 扫描桌面图标失败: ${error.message}`;
    }
}

export async function handleGuiMoveMouse(args: any): Promise<string> {
    try {
        const gui = await getGuiService();
        await gui.moveMouse(args.x, args.y);
        const pos = await gui.getCursorPosition();
        return `[OK] 鼠标已移动到 (${pos.x}, ${pos.y})`;
    } catch (error: any) {
        return `[ERROR] 移动鼠标失败: ${error.message}`;
    }
}

export async function handleGuiGetWindows(args: any): Promise<string> {
    try {
        const gui = await getGuiService();
        const windows = await gui.getWindowList();
        if (windows.length === 0) return '[OK] 未找到可见窗口';
        const lines = windows.map((w: { process: string; title: string }, i: number) => `${i + 1}. [${w.process}] ${w.title}`).join('\n');
        return `[OK] 当前可见窗口列表 (${windows.length} 个):\n${lines}`;
    } catch (error: any) {
        return `[ERROR] 获取窗口列表失败: ${error.message}`;
    }
}

export async function handleGuiScanScreen(args: any): Promise<string> {
    try {
        const gui = await getGuiService();
        const elements = await gui.scanScreenElements(args.window_title);
        if (elements.length === 0) return '[OK] 未扫描到可交互控件（目标软件可能使用自定义渲染，建议改用 gui_screenshot 视觉方式）';
        const lines = elements.map((el: { type: string; name: string; value?: string; enabled: boolean; x: number; y: number; width: number; height: number }, i: number) => {
            const idx = String(i + 1).padStart(2, ' ');
            const val = el.value ? ` 值:'${el.value}'` : '';
            const en = el.enabled ? '' : ' [禁用]';
            return `#${idx} [${el.type}]${en} "${el.name}"${val} → 坐标(${el.x},${el.y}) 尺寸:${el.width}x${el.height}`;
        }).join('\n');
        return `[OK] 屏幕语义扫描 (共${elements.length}个控件):\n${lines}\n\n✅ 推荐: 使用 gui_click_element 按名称点击（最准确），或直接用上方坐标调用 gui_click`;
    } catch (error: any) {
        return `[ERROR] 屏幕扫描失败: ${error.message}`;
    }
}

export async function handleGuiFocusWindow(args: any): Promise<string> {
    try {
        const gui = await getGuiService();
        const result = await gui.focusWindow(args.title);
        return `[OK] ${result}。调用 gui_screenshot 验证结果。`;
    } catch (error: any) {
        return `[ERROR] 聚焦窗口失败: ${error.message}`;
    }
}

/**
 * gui_click_element: Find element by name via UI Automation, verify cursor reached it, then click.
 * This is the preferred click method — no coordinate guessing needed.
 */
export async function handleGuiClickElement(args: any): Promise<string> {
    const blocked = await checkGuiEmergencyAbort();
    if (blocked) return blocked;
    try {
        const gui = await getGuiService();
        const elements = await gui.scanScreenElements(args.window_title);
        if (elements.length === 0) {
            return '[ERROR] gui_click_element: UI Automation 未扫描到任何控件，目标软件可能使用自定义渲染。请改用 gui_click 配合截图坐标。';
        }

        // Fuzzy match: case-insensitive substring search
        const needle = (args.element_name || '').toLowerCase().trim();
        const match = elements.find((el: any) =>
            el.name.toLowerCase().includes(needle) || needle.includes(el.name.toLowerCase())
        );

        if (!match) {
            const names = elements.slice(0, 20).map((e: any) => `"${e.name}"`).join(', ');
            return `[ERROR] 未找到名称含 "${args.element_name}" 的控件。\n当前可用元素(前20个): ${names}\n请检查元素名称或先调用 gui_scan_screen 查看完整列表。`;
        }

        // Step 1: Move cursor to target
        await gui.moveMouse(match.x, match.y);
        await new Promise(r => setTimeout(r, 120));

        // Step 2: Verify cursor arrived (within ±10px tolerance)
        const pos = await gui.getCursorPosition();
        const dx = Math.abs(pos.x - match.x);
        const dy = Math.abs(pos.y - match.y);
        if (dx > 15 || dy > 15) {
            return `[ERROR] 光标验证失败: 目标(${match.x},${match.y}) 但光标实际在(${pos.x},${pos.y})，偏差过大，已中止点击。`;
        }

        // Step 3: Click
        const button = args.button === 'right' ? 'right' : 'left';
        await gui.clickMouse(match.x, match.y, button);
        await new Promise(r => setTimeout(r, 500));

        // Step 4: Take screenshot to confirm
        const result = await gui.takeScreenshot();
        return formatScreenshotResult(result,
            `[OK] 已点击元素 "${match.name}" [${match.type}] (验证坐标: ${pos.x},${pos.y})`);
    } catch (error: any) {
        return `[ERROR] gui_click_element 失败: ${error.message}`;
    }
}

/**
 * gui_emergency_reset: Clear the emergency abort flag so GUI operations can resume.
 */
export async function handleGuiEmergencyReset(args: any): Promise<string> {
    try {
        const gui = await getGuiService();
        gui.resetEmergencyAbort();
        return '[OK] ✅ GUI紧急中止状态已重置，可以继续操控桌面。';
    } catch (error: any) {
        return `[ERROR] 重置紧急中止失败: ${error.message}`;
    }
}

/**
 * gui_screenshot_annotated: The flagship SoM tool.
 * One call = screenshot capture + UI Automation scan + GDI+ numbered overlay drawing.
 * Returns the annotated image (displayed to user) + numbered element table (for Agent).
 */
export async function handleGuiScreenshotAnnotated(args: any): Promise<string> {
    const blocked = await checkGuiEmergencyAbort();
    if (blocked) return blocked;
    try {
        const gui = await getGuiService();
        const result = await gui.takeAnnotatedScreenshot();

        const lines: string[] = [];
        lines.push(`[OK] SoM标注截图已生成 | 屏幕: ${result.screenWidth}x${result.screenHeight}`);
        if (result.cursorX !== undefined) {
            lines.push(`🖱️ 当前鼠标位置: (${result.cursorX}, ${result.cursorY})`);
        }

        if (result.elements.length === 0) {
            lines.push('⚠️ 未扫描到可交互控件（UI Automation 无结果），截图中无编号标注。');
            lines.push('   → 对于游戏/自绘UI，请改用 gui_screenshot 配合视觉推理。');
        } else {
            lines.push(`\n📋 标注元素表 (共 ${result.elements.length} 个，圆形编号可在图中看到):`);
            result.elements.forEach((el: { idx: number; type: string; name: string; value: string; x: number; y: number }) => {
                const val = el.value ? ` 值:'${el.value}'` : '';
                lines.push(`  #${String(el.idx).padStart(2, ' ')} [${el.type}] "${el.name}"${val} → 坐标(${el.x},${el.y})`);
            });
            lines.push(`\n✅ 使用 gui_click_marker(marker=N) 按编号点击，无需猜坐标`);
        }

        // Append the image data URL so the frontend renders it
        lines.push(`${GUI_SCREENSHOT_PREFIX}${result.dataUrl}`);
        return lines.join('\n');
    } catch (error: any) {
        return `[ERROR] SoM标注截图失败: ${error.message}`;
    }
}

/**
 * gui_click_marker: Click an element by the numbered marker shown in the annotated screenshot.
 * Flow: annotated scan → find element by idx → move → verify → click.
 */
export async function handleGuiClickMarker(args: any): Promise<string> {
    const blocked = await checkGuiEmergencyAbort();
    if (blocked) return blocked;
    try {
        const markerNum = parseInt(args.marker);
        if (!markerNum || markerNum < 1) {
            return '[ERROR] gui_click_marker: marker 参数必须是正整数，对应截图中的编号圆圈。';
        }

        const gui = await getGuiService();

        // Re-scan to get fresh coordinates (screen may have changed since last annotated screenshot)
        const result = await gui.takeAnnotatedScreenshot();
        const target = result.elements.find((el: { idx: number; type: string; name: string; value: string; x: number; y: number }) => el.idx === markerNum);

        if (!target) {
            const available = result.elements.map((e: { idx: number }) => e.idx).join(', ');
            return `[ERROR] 未找到编号 ${markerNum} 的标注元素。当前可用编号: ${available}\n请先调用 gui_screenshot_annotated 刷新标注。`;
        }

        // Move cursor to center of element
        await gui.moveMouse(target.x, target.y);
        await new Promise(r => setTimeout(r, 120));

        // Verify cursor arrived (±10px)
        const pos = await gui.getCursorPosition();
        const dx = Math.abs(pos.x - target.x);
        const dy = Math.abs(pos.y - target.y);
        if (dx > 15 || dy > 15) {
            return `[ERROR] 光标验证失败: 目标#${markerNum}(${target.x},${target.y}) 但光标在(${pos.x},${pos.y})，偏差过大，已中止。`;
        }

        // Click
        const button = args.button === 'right' ? 'right' : 'left';
        await gui.clickMouse(target.x, target.y, button);
        await new Promise(r => setTimeout(r, 500));

        // Return a fresh plain screenshot to confirm result
        const screenshot = await gui.takeScreenshot();
        return formatScreenshotResult(screenshot,
            `[OK] 已点击标注#${markerNum} "${target.name}" [${target.type}] (验证坐标: ${pos.x},${pos.y})`);
    } catch (error: any) {
        return `[ERROR] gui_click_marker 失败: ${error.message}`;
    }
}

export async function executeAgentTool(name: string, args: any, options?: ToolOptions): Promise<string> {
    try {
        const handler = toolHandlers[name];
        if (handler) {
            return await handler(args, options);
        }
        return `Error: Unknown tool "${name}"`;
    } catch (error: any) {
        return `Error executing ${name}: ${error.message || 'Unknown error'}`;
    }
}
