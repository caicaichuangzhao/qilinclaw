import screenshot from 'screenshot-desktop';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export interface ScreenshotResult {
    dataUrl: string;
    screenWidth: number;
    screenHeight: number;
    imageWidth: number;
    imageHeight: number;
    scaleFactor: number;  // DPI scale factor (1.0 = 100%, 1.5 = 150%, 2.0 = 200%)
    cursorX?: number;     // Current mouse cursor X position at time of screenshot
    cursorY?: number;     // Current mouse cursor Y position at time of screenshot
}

export interface WindowInfo {
    title: string;
    process: string;
    x: number;
    y: number;
    width: number;
    height: number;
    isVisible: boolean;
}

export interface UIElement {
    type: string;     // Button, Edit, Text, List, ComboBox, CheckBox, etc.
    name: string;     // Accessible name/label
    x: number;       // Center X coordinate (screen logical coords)
    y: number;       // Center Y coordinate (screen logical coords)
    width: number;
    height: number;
    enabled: boolean;
    value?: string;  // Current text/value if applicable
}

/**
 * GUIService - Desktop GUI automation service
 *
 * Uses screenshot-desktop for screen capture fallback.
 * Mouse/keyboard control via PowerShell scripts calling Windows user32.dll APIs.
 * Each action runs a pre-written .ps1 script with Add-Type P/Invoke,
 * passing action parameters as command-line args.
 */
export class GUIService {
    private static instance: GUIService;
    private scriptPath: string;
    private screenshotScriptPath: string = '';
    private escListenerScriptPath: string = '';
    private annotatedScreenshotScriptPath: string = '';

    // AbortController for the currently-running PowerShell action
    private currentAbortController: AbortController | null = null;

    // Last known image vs screen dimensions for auto coordinate scaling
    private lastKnownCoords = { imageW: 0, imageH: 0, screenW: 0, screenH: 0 };

    // Emergency abort: set to true when user double-presses ESC during a GUI action
    private emergencyAbortFlag: boolean = false;
    // The background PS process that listens for double-ESC
    private escListenerProcess: any = null;
    // Gate: only respond to double-ESC signals while this is true.
    // Defaults to true so users can interrupt at any point, ignored only during programmatic ESC.
    private escListeningEnabled: boolean = true;

    private constructor() {
        const guiDir = path.resolve(process.cwd(), '.qilin-claw', 'gui-scripts');
        if (!fs.existsSync(guiDir)) {
            fs.mkdirSync(guiDir, { recursive: true });
        }
        this.scriptPath = path.join(guiDir, 'gui_action.ps1');
        this.screenshotScriptPath = path.join(guiDir, 'gui_screenshot.ps1');
        this.escListenerScriptPath = path.join(guiDir, 'gui_esc_listener.ps1');
        this.annotatedScreenshotScriptPath = path.join(guiDir, 'gui_annotated_screenshot.ps1');
        this.writeActionScript();
        this.writeScreenshotScript();
        this.writeEscListenerScript();
        this.writeAnnotatedScreenshotScript();
        this.startEscListener();
    }

    public static getInstance(): GUIService {
        if (!GUIService.instance) {
            GUIService.instance = new GUIService();
        }
        return GUIService.instance;
    }

    /**
     * Force PowerShell scripts to emit UTF-8 so Node's default stdout decoding
     * does not corrupt Chinese UI labels on Windows hosts with non-UTF-8 code pages.
     */
    private getUtf8PowerShellPrelude(): string[] {
        return [
            '$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)',
            '[Console]::InputEncoding = $Utf8NoBom',
            '[Console]::OutputEncoding = $Utf8NoBom',
            '$OutputEncoding = $Utf8NoBom',
        ];
    }

    /**
     * Write the unified PowerShell action script.
     * This script accepts action + params as command-line arguments.
     */
    private writeActionScript() {
        // NOTE: PowerShell operators must NOT have spaces around them (-ge, -contains, etc.)
        // The script is written to a .ps1 file and executed via execFile to avoid shell escaping issues.
        const script = [
            'param([string]$action, [string]$p1, [string]$p2, [string]$p3, [string]$p4, [string]$p5)',
            '$ErrorActionPreference = \'Stop\'',
            ...this.getUtf8PowerShellPrelude(),
            '',
            '$cs = @\'',
            'using System;',
            'using System.Runtime.InteropServices;',
            'using System.Threading;',
            '',
            '// NOTE: We do NOT call SetProcessDPIAware() here.',
            '// Running DPI-unaware means SetCursorPos accepts LOGICAL pixel coordinates,',
            '// which matches CopyFromScreen coordinate space (both logical).',
            'public class G {',
            '    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);',
            '    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);',
            '    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);',
            '    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint f, IntPtr e);',
            '    [DllImport("user32.dll")] public static extern short VkKeyScan(char ch);',
            '    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
            '    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
            '    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }',
            '}',
            '\'@',
            'Add-Type -TypeDefinition $cs',
            '',
            'switch ($action) {',
            '    \'move\' {',
            '        [G]::SetCursorPos([int]$p1, [int]$p2)',
            '        Write-Output "OK"',
            '    }',
            '    \'click\' {',
            '        [G]::SetCursorPos([int]$p1, [int]$p2)',
            '        Start-Sleep -Milliseconds 30',
            '        [G]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)',
            '        Start-Sleep -Milliseconds 20',
            '        [G]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)',
            '        Write-Output "OK"',
            '    }',
            '    \'rightclick\' {',
            '        [G]::SetCursorPos([int]$p1, [int]$p2)',
            '        Start-Sleep -Milliseconds 30',
            '        [G]::mouse_event(0x0008, 0, 0, 0, [IntPtr]::Zero)',
            '        Start-Sleep -Milliseconds 20',
            '        [G]::mouse_event(0x0010, 0, 0, 0, [IntPtr]::Zero)',
            '        Write-Output "OK"',
            '    }',
            '    \'doubleclick\' {',
            '        [G]::SetCursorPos([int]$p1, [int]$p2)',
            '        Start-Sleep -Milliseconds 30',
            '        [G]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)',
            '        [G]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)',
            '        Start-Sleep -Milliseconds 60',
            '        [G]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)',
            '        [G]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)',
            '        Write-Output "OK"',
            '    }',
            '    \'scroll\' {',
            '        [G]::SetCursorPos([int]$p1, [int]$p2)',
            '        Start-Sleep -Milliseconds 30',
            '        $amt = [int]$p3 * 120',
            '        [G]::mouse_event(0x0800, 0, 0, [uint32]$amt, [IntPtr]::Zero)',
            '        Write-Output "OK"',
            '    }',
            '    \'drag\' {',
            '        $fx=[int]$p1; $fy=[int]$p2; $tx=[int]$p3; $ty=[int]$p4',
            '        [G]::SetCursorPos($fx, $fy)',
            '        Start-Sleep -Milliseconds 80',
            '        [G]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)',
            '        Start-Sleep -Milliseconds 80',
            '        for ($i=1; $i -le 10; $i++) {',
            '            $cx = $fx + ($tx - $fx) * $i / 10',
            '            $cy = $fy + ($ty - $fy) * $i / 10',
            '            [G]::SetCursorPos([int]$cx, [int]$cy)',
            '            Start-Sleep -Milliseconds 15',
            '        }',
            '        Start-Sleep -Milliseconds 80',
            '        [G]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)',
            '        Write-Output "OK"',
            '    }',
            '    \'key\' {',
            '        # p1 = comma-sep hex VK codes, p2 = comma-sep extended flags (0 or 1)',
            '        $vks = $p1 -split \',\'',
            '        $exts = $p2 -split \',\'',
            '        if ($vks.Length -eq 1) {',
            '            $vk = [byte]([Convert]::ToInt32($vks[0], 16))',
            '            $ef = if ($exts[0] -eq \'1\') { [uint32]1 } else { [uint32]0 }',
            '            [G]::keybd_event($vk, 0, $ef, [IntPtr]::Zero)',
            '            Start-Sleep -Milliseconds 30',
            '            [G]::keybd_event($vk, 0, ($ef -bor 2), [IntPtr]::Zero)',
            '        } else {',
            '            for ($i=0; $i -lt $vks.Length - 1; $i++) {',
            '                $vk = [byte]([Convert]::ToInt32($vks[$i], 16))',
            '                $ef = if ($exts[$i] -eq \'1\') { [uint32]1 } else { [uint32]0 }',
            '                [G]::keybd_event($vk, 0, $ef, [IntPtr]::Zero)',
            '                Start-Sleep -Milliseconds 20',
            '            }',
            '            $lastVk = [byte]([Convert]::ToInt32($vks[$vks.Length - 1], 16))',
            '            $lastEf = if ($exts[$exts.Length - 1] -eq \'1\') { [uint32]1 } else { [uint32]0 }',
            '            [G]::keybd_event($lastVk, 0, $lastEf, [IntPtr]::Zero)',
            '            Start-Sleep -Milliseconds 30',
            '            [G]::keybd_event($lastVk, 0, ($lastEf -bor 2), [IntPtr]::Zero)',
            '            for ($i=$vks.Length - 2; $i -ge 0; $i--) {',
            '                $vk = [byte]([Convert]::ToInt32($vks[$i], 16))',
            '                $ef = if ($exts[$i] -eq \'1\') { [uint32]1 } else { [uint32]0 }',
            '                [G]::keybd_event($vk, 0, ($ef -bor 2), [IntPtr]::Zero)',
            '            }',
            '        }',
            '        Write-Output "OK"',
            '    }',
            '    \'type\' {',
            '        # p1 = text to type',
            '        Add-Type -AssemblyName System.Windows.Forms',
            '        # Escape SendKeys special characters',
            '        $escaped = $p1 -replace \'([+^%~{}\\[\\](]))\',\'{$1}\'',
            '        [System.Windows.Forms.SendKeys]::SendWait($escaped)',
            '        Write-Output "OK"',
            '    }',
            '    \'getpos\' {',
            '        $p = New-Object G+POINT',
            '        [G]::GetCursorPos([ref]$p) | Out-Null',
            '        Write-Output "$($p.X),$($p.Y)"',
            '    }',
            '    \'focuswindow\' {',
            '        # p1 = partial window title to match',
            '        $procs = [System.Diagnostics.Process]::GetProcesses()',
            '        $found = $false',
            '        foreach ($proc in $procs) {',
            '            try {',
            '                if ($proc.MainWindowTitle -and $proc.MainWindowTitle.ToLower().Contains($p1.ToLower())) {',
            '                    [G]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null',
            '                    [G]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null',
            '                    Write-Output "OK: Focused \'$($proc.MainWindowTitle)\'"',
            '                    $found = $true',
            '                    break',
            '                }',
            '            } catch {}',
            '        }',
            '        if (-not $found) { Write-Output "ERROR: No window found matching \'$p1\'" }',
            '    }',
            '    \'getwindows\' {',
            '        $procs = [System.Diagnostics.Process]::GetProcesses()',
            '        $list = @()',
            '        foreach ($proc in $procs) {',
            '            try {',
            '                if ($proc.MainWindowTitle -and $proc.MainWindowTitle.Trim() -ne \'\') {',
            '                    $list += "$($proc.MainWindowTitle)|$($proc.ProcessName)|0|0|0|0"',
            '                }',
            '            } catch {}',
            '        }',
            '        Write-Output ($list -join "`n")',
            '    }',
            '    \'scanscreen\' {',
            '        # p1 = optional window title filter',
            '        Add-Type -AssemblyName UIAutomationClient',
            '        Add-Type -AssemblyName UIAutomationTypes',
            '        Add-Type -AssemblyName System.Windows.Forms',
            '        # UIAutomation.BoundingRectangle in a DPI-unaware process returns LOGICAL coords.',
            '        # Do NOT multiply by any scale factor — direct use keeps units consistent with SetCursorPos.',
            '        $root = [System.Windows.Automation.AutomationElement]::RootElement',
            '        $scope = [System.Windows.Automation.TreeScope]::Subtree',
            '        $condition = [System.Windows.Automation.Condition]::TrueCondition',
            '        $interactableTypes = @(\'button\',\'edit\',\'combobox\',\'checkbox\',\'radiobutton\',\'listitem\',\'menuitem\',\'hyperlink\',\'listbox\',\'tree\',\'treeitem\',\'spinner\',\'slider\',\'tabitem\',\'custom\')',
            '        # If a window title filter is given, try to narrow scope',
            '        $searchRoot = $root',
            '        if ($p1 -and $p1 -ne \'\') {',
            '            $procs = [System.Diagnostics.Process]::GetProcesses()',
            '            foreach ($proc in $procs) {',
            '                try {',
            '                    if ($proc.MainWindowTitle -and $proc.MainWindowTitle.ToLower().Contains($p1.ToLower())) {',
            '                        $winEl = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)',
            '                        if ($winEl) { $searchRoot = $winEl }',
            '                        break',
            '                    }',
            '                } catch {}',
            '            }',
            '        }',
            '        $elements = $searchRoot.FindAll($scope, $condition)',
            '        $results = @()',
            '        $count = 0',
            '        foreach ($el in $elements) {',
            '            if ($count -ge 100) { break }',
            '            try {',
            '                $ctrlType = $el.Current.ControlType.ProgrammaticName.Replace(\'ControlType.\', \'\').ToLower()',
            '                if ($interactableTypes -contains $ctrlType) {',
            '                    $rect = $el.Current.BoundingRectangle',
            '                    if ($rect.Width -gt 0 -and $rect.Height -gt 0) {',
            '                        $name = $el.Current.Name',
            '                        $value = \'\'',
            '                        try {',
            '                            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)',
            '                            $value = $vp.Current.Value',
            '                        } catch {}',
            '                        # BoundingRectangle is already in logical pixels — use directly',
            '                        $cx = [int]($rect.X + $rect.Width / 2)',
            '                        $cy = [int]($rect.Y + $rect.Height / 2)',
            '                        $obj = [PSCustomObject]@{',
            '                            type    = $ctrlType',
            '                            name    = ($el.Current.Name -replace \'"\',\'\')',
            '                            x       = $cx',
            '                            y       = $cy',
            '                            w       = [int]$rect.Width',
            '                            h       = [int]$rect.Height',
            '                            enabled = $el.Current.IsEnabled',
            '                            value   = ($value -replace \'"\',\'\')',
            '                        }',
            '                        $results += $obj',
            '                        $count++',
            '                    }',
            '                }',
            '            } catch {}',
            '        }',
            '        Write-Output ($results | ConvertTo-Json -Compress)',
            '    }',
            '    \'desktopicons\' {',
            '        # Enumerate desktop file icons via SysListView32 Win32 API',
            '        # Desktop icons are NOT visible to UIAutomation, so we use SendMessage directly.',
            '        $lv32cs = @\'',
            'using System;',
            'using System.Runtime.InteropServices;',
            'using System.Text;',
            'public class LV32 {',
            '    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string win);',
            '    [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string cls, string win);',
            '    [DllImport("user32.dll")] public static extern int SendMessage(IntPtr hwnd, int msg, int wParam, int lParam);',
            '    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);',
            '    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }',
            '    const int LVM_GETITEMCOUNT = 0x1004;',
            '    const int LVM_GETITEMRECT  = 0x100E;',
            '    const int LVM_GETITEMTEXT  = 0x1073;',
            '    [StructLayout(LayoutKind.Sequential)] public struct LVITEM {',
            '        public int mask, iItem, iSubItem, state, stateMask;',
            '        public IntPtr pszText; public int cchTextMax, iImage;',
            '    }',
            '    [StructLayout(LayoutKind.Sequential)] public struct LVITEMA {',
            '        public int L, T, R, B;',
            '    }',
            '    public static int GetItemCount(IntPtr hwnd) {',
            '        return SendMessage(hwnd, LVM_GETITEMCOUNT, 0, 0);',
            '    }',
            '}',
            '\'@',
            '        try { Add-Type -TypeDefinition $lv32cs -ErrorAction SilentlyContinue } catch {}',
            '        # Find the SysListView32 inside Progman -> WorkerW chain',
            '        $progman = [LV32]::FindWindow("Progman", $null)',
            '        $workerW = [IntPtr]::Zero',
            '        $defView  = [LV32]::FindWindowEx($progman, [IntPtr]::Zero, "SHELLDLL_DefView", $null)',
            '        if ($defView -eq [IntPtr]::Zero) {',
            '            # Try WorkerW siblings',
            '            $ww = [LV32]::FindWindowEx([IntPtr]::Zero, $progman, "WorkerW", $null)',
            '            while ($ww -ne [IntPtr]::Zero) {',
            '                $defView = [LV32]::FindWindowEx($ww, [IntPtr]::Zero, "SHELLDLL_DefView", $null)',
            '                if ($defView -ne [IntPtr]::Zero) { $workerW = $ww; break }',
            '                $ww = [LV32]::FindWindowEx([IntPtr]::Zero, $ww, "WorkerW", $null)',
            '            }',
            '        }',
            '        $lvHwnd = [LV32]::FindWindowEx($defView, [IntPtr]::Zero, "SysListView32", $null)',
            '        if ($lvHwnd -eq [IntPtr]::Zero) {',
            '            Write-Output "[]"',
            '        } else {',
            '            # Get window origin to offset item rects',
            '            $wRect = New-Object LV32+RECT',
            '            [LV32]::GetWindowRect($lvHwnd, [ref]$wRect) | Out-Null',
            '            $originX = $wRect.L; $originY = $wRect.T',
            '            # Use PowerShell 5 shell COM to get names + positions (more reliable than sendmsg across process)',
            '            $shell = New-Object -ComObject Shell.Application',
            '            $desktop = $shell.NameSpace(0)  # 0 = Desktop',
            '            if (-not $desktop) {',
            '                Write-Output "[]"',
            '            } else {',
            '                $icons = @()',
            '                foreach ($item in $desktop.Items()) {',
            '                    try {',
            '                        $name = $item.Name',
            '                        $path = $item.Path',
            '                        $icons += [PSCustomObject]@{ name=$name; path=$path }',
            '                    } catch {}',
            '                }',
            '                # Pair names with ListView item positions via index',
            '                $itemCount = [LV32]::GetItemCount($lvHwnd)',
            '                $results = @()',
            '                # Match by index -- Shell.Items() and LV items share same ordering',
            '                $idx = 0',
            '                foreach ($icon in $icons) {',
            '                    if ($idx -ge $itemCount) { break }',
            '                    # Get item bounding rect via LVM_GETITEMRECT (LVIR_ICON = 1)',
            '                    $rectBuf = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(16)',
            '                    [System.Runtime.InteropServices.Marshal]::WriteInt32($rectBuf, 1)  # LVIR_ICON',
            '                    [LV32]::SendMessage($lvHwnd, 0x100E, $idx, $rectBuf.ToInt64()) | Out-Null',
            '                    $l=[System.Runtime.InteropServices.Marshal]::ReadInt32($rectBuf,0)',
            '                    $t=[System.Runtime.InteropServices.Marshal]::ReadInt32($rectBuf,4)',
            '                    $r=[System.Runtime.InteropServices.Marshal]::ReadInt32($rectBuf,8)',
            '                    $b=[System.Runtime.InteropServices.Marshal]::ReadInt32($rectBuf,12)',
            '                    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($rectBuf)',
            '                    $cx = $originX + [int](($l+$r)/2)',
            '                    $cy = $originY + [int](($t+$b)/2)',
            '                    if ($r -gt $l -and $b -gt $t) {',
            '                        $results += [PSCustomObject]@{ name=$icon.name; path=$icon.path; x=$cx; y=$cy; w=$r-$l; h=$b-$t }',
            '                    }',
            '                    $idx++',
            '                }',
            '                Write-Output ($results | ConvertTo-Json -Compress)',
            '            }',
            '        }',
            '    }',
            '    default {',
            '        Write-Output "ERROR: Unknown action: $action"',
            '    }',
            '}',
        ].join('\n');

        fs.writeFileSync(this.scriptPath, script, 'utf-8');
        console.log('[GUIService] PowerShell GUI action script created at:', this.scriptPath);
    }

    /**
     * Write the screenshot PowerShell script.
     * Captures at LOGICAL resolution (no SetProcessDPIAware) so all coordinates
     * are in the same logical space as SetCursorPos (DPI-unaware).
     * Output: "W,H,cursorX,cursorY|<base64-png>" — all LOGICAL pixel values.
     */
    private writeScreenshotScript() {
        const script = [
            '$ErrorActionPreference = "Stop"',
            ...this.getUtf8PowerShellPrelude(),
            'Add-Type -AssemblyName System.Drawing',
            'Add-Type -AssemblyName System.Windows.Forms',
            // Logical screen size — matches SetCursorPos coordinate space (DPI-unaware)
            '$scr = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
            '$W = $scr.Width; $H = $scr.Height',
            '$bmp = New-Object System.Drawing.Bitmap($W, $H)',
            '$g = [System.Drawing.Graphics]::FromImage($bmp)',
            '$g.CopyFromScreen(0, 0, 0, 0, $bmp.Size)',
            // Logical cursor position — Cursor.Position always returns logical coords
            '$cur = [System.Windows.Forms.Cursor]::Position',
            '$cx = $cur.X; $cy = $cur.Y',
            '$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Red, 3)',
            '$r = 12',
            '$g.DrawLine($pen, [int]($cx - $r), [int]$cy, [int]($cx + $r), [int]$cy)',
            '$g.DrawLine($pen, [int]$cx, [int]($cy - $r), [int]$cx, [int]($cy + $r))',
            '$g.FillEllipse([System.Drawing.Brushes]::Red, [int]($cx - 5), [int]($cy - 5), 10, 10)',
            '$pen.Dispose(); $g.Dispose()',
            '$ms = New-Object System.IO.MemoryStream',
            '$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
            '$bmp.Dispose()',
            'Write-Output ("$W,$H,$cx,$cy|" + [Convert]::ToBase64String($ms.ToArray()))',
        ].join('\n');

        fs.writeFileSync(this.screenshotScriptPath, script, 'utf-8');
        console.log('[GUIService] Screenshot PS1 script (logical coords) created at:', this.screenshotScriptPath);
    }

    /**
     * Write the SoM annotated screenshot PowerShell script.
     *
     * In a single PS process (LOGICAL coordinates throughout — no SetProcessDPIAware):
     * 1. Capture desktop at logical resolution
     * 2. Run UI Automation to get element bounding boxes (logical coords)
     * 3. Draw colored numbered overlays using GDI+
     * 4. Output: "W,H,cursorX,cursorY|<base64-png>|<json-elements>" — all logical
     */
    private writeAnnotatedScreenshotScript() {
        const script = [
            '$ErrorActionPreference = "Stop"',
            ...this.getUtf8PowerShellPrelude(),
            'Add-Type -AssemblyName System.Drawing',
            'Add-Type -AssemblyName UIAutomationClient',
            'Add-Type -AssemblyName UIAutomationTypes',
            'Add-Type -AssemblyName System.Windows.Forms',
            // Logical screen size — same coord space as SetCursorPos (DPI-unaware)
            '$scr = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
            '$physW = $scr.Width',
            '$physH = $scr.Height',
            // Capture at logical resolution
            '$bmp = New-Object System.Drawing.Bitmap($physW, $physH)',
            '$g = [System.Drawing.Graphics]::FromImage($bmp)',
            '$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias',
            '$g.CopyFromScreen(0, 0, 0, 0, $bmp.Size)',
            // Logical cursor position
            '$cur = [System.Windows.Forms.Cursor]::Position',
            '$cx = $cur.X; $cy = $cur.Y',
            // Draw cursor crosshair
            '$crossPen = New-Object System.Drawing.Pen([System.Drawing.Color]::Red, 3)',
            '$g.DrawLine($crossPen, [int]($cx-12), [int]$cy, [int]($cx+12), [int]$cy)',
            '$g.DrawLine($crossPen, [int]$cx, [int]($cy-12), [int]$cx, [int]($cy+12))',
            '$g.FillEllipse([System.Drawing.Brushes]::Red, [int]($cx-5), [int]($cy-5), 10, 10)',
            '$crossPen.Dispose()',
            // UI Automation scan — in DPI-unaware process, rect coords are logical (scale=1.0)
            '$logiW = $physW',
            '$scale = 1.0',
            '$root = [System.Windows.Automation.AutomationElement]::RootElement',
            '$scope = [System.Windows.Automation.TreeScope]::Subtree',
            '$cond = [System.Windows.Automation.Condition]::TrueCondition',
            '$interactable = @("button","edit","combobox","checkbox","radiobutton","listitem","menuitem","hyperlink","listbox","treeitem","spinner","slider","tabitem","custom")',
            '$elements = $root.FindAll($scope, $cond)',
            '$items = @()',
            '$idx = 0',
            // Color palette: cycle through distinct colors for visibility
            '$colors = @(',
            '    [System.Drawing.Color]::FromArgb(255,59,130,246),  # blue',
            '    [System.Drawing.Color]::FromArgb(255,16,185,129),  # green',
            '    [System.Drawing.Color]::FromArgb(255,245,158,11),  # amber',
            '    [System.Drawing.Color]::FromArgb(255,239,68,68),   # red',
            '    [System.Drawing.Color]::FromArgb(255,139,92,246),  # purple',
            '    [System.Drawing.Color]::FromArgb(255,236,72,153),  # pink',
            '    [System.Drawing.Color]::FromArgb(255,20,184,166)   # teal',
            ')',
            '$font = New-Object System.Drawing.Font("Arial", 9, [System.Drawing.FontStyle]::Bold)',
            'foreach ($el in $elements) {',
            '    if ($idx -ge 80) { break }',
            '    try {',
            '        $ct = $el.Current.ControlType.ProgrammaticName.Replace("ControlType.","").ToLower()',
            '        if (-not ($interactable -contains $ct)) { continue }',
            '        $rect = $el.Current.BoundingRectangle',
            '        if ($rect.Width -le 0 -or $rect.Height -le 0) { continue }',
            '        $name = $el.Current.Name -replace \'"\',""',
            '        $val = ""',
            '        try { $val = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value -replace \'"\',"" } catch {}',
            '        $px = [int]($rect.X * $scale)',
            '        $py = [int]($rect.Y * $scale)',
            '        $pw = [int]($rect.Width * $scale)',
            '        $ph = [int]($rect.Height * $scale)',
            '        $centX = $px + [int]($pw / 2)',
            '        $centY = $py + [int]($ph / 2)',
            '        # Draw element box',
            '        $col = $colors[$idx % $colors.Length]',
            '        $pen = New-Object System.Drawing.Pen($col, 2)',
            '        $g.DrawRectangle($pen, $px, $py, $pw, $ph)',
            '        $pen.Dispose()',
            '        # Draw index badge (filled circle with number)',
            '        $badgeSize = 18',
            '        $badgeX = $px',
            '        $badgeY = $py - $badgeSize',
            '        if ($badgeY -lt 0) { $badgeY = $py }',
            '        $brush = New-Object System.Drawing.SolidBrush($col)',
            '        $g.FillEllipse($brush, $badgeX, $badgeY, $badgeSize, $badgeSize)',
            '        $brush.Dispose()',
            '        $label = "$($idx+1)"',
            '        $textSize = $g.MeasureString($label, $font)',
            '        $tx = $badgeX + ($badgeSize - $textSize.Width) / 2',
            '        $ty = $badgeY + ($badgeSize - $textSize.Height) / 2',
            '        $g.DrawString($label, $font, [System.Drawing.Brushes]::White, [float]$tx, [float]$ty)',
            '        $items += [PSCustomObject]@{ idx=$idx+1; type=$ct; name=$name; value=$val; x=$centX; y=$centY; w=$pw; h=$ph }',
            '        $idx++',
            '    } catch {}',
            '}',
            '$font.Dispose(); $g.Dispose()',
            // Encode PNG
            '$ms = New-Object System.IO.MemoryStream',
            '$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
            '$bmp.Dispose()',
            '$b64 = [Convert]::ToBase64String($ms.ToArray())',
            '$jsonItems = $items | ConvertTo-Json -Compress',
            'if (-not $jsonItems) { $jsonItems = "[]" }',
            'Write-Output ("$physW,$physH,$cx,$cy|" + $b64 + "|" + $jsonItems)',
        ].join('\n');
        fs.writeFileSync(this.annotatedScreenshotScriptPath, script, 'utf-8');
        console.log('[GUIService] Annotated screenshot script created at:', this.annotatedScreenshotScriptPath);
    }

    /**
     * Annotated SoM screenshot: captures the desktop, scans UI elements,
     * overlays numbered colored boxes on the image.
     *
     * Returns:
     *  - dataUrl: the annotated PNG as data URL
     *  - elements: array of {idx, type, name, value, x, y, w, h}
     *  - screenWidth / screenHeight
     *  - cursorX / cursorY
     */
    public async takeAnnotatedScreenshot(): Promise<{
        dataUrl: string;
        elements: Array<{ idx: number; type: string; name: string; value: string; x: number; y: number; w: number; h: number }>;
        screenWidth: number;
        screenHeight: number;
        cursorX?: number;
        cursorY?: number;
    }> {
        if (this.emergencyAbortFlag) {
            throw new Error('GUI EMERGENCY STOP active. Call gui_emergency_reset to resume.');
        }
        const controller = new AbortController();
        this.currentAbortController = controller;
        try {
            const { stdout } = await execFileAsync('powershell.exe', [
                '-NoProfile', '-ExecutionPolicy', 'Bypass',
                '-File', this.annotatedScreenshotScriptPath,
            ], { timeout: 25000, maxBuffer: 50 * 1024 * 1024, signal: controller.signal as any });

            const raw = stdout.trim();
            if (!raw || raw.length < 100) throw new Error('Empty annotated screenshot output');

            // Format: "physW,physH,cursorX,cursorY|<base64png>|<json>"
            const parts = raw.split('|');
            if (parts.length < 2) throw new Error('Invalid annotated screenshot output format');

            const meta = parts[0].split(',');
            const screenWidth = parseInt(meta[0]) || 1920;
            const screenHeight = parseInt(meta[1]) || 1080;
            const cursorX = parseInt(meta[2]) || undefined;
            const cursorY = parseInt(meta[3]) || undefined;

            const base64 = parts[1];
            const jsonStr = parts.slice(2).join('|'); // rejoin in case json contains |

            let elements: any[] = [];
            try {
                const parsed = JSON.parse(jsonStr);
                elements = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
            } catch {
                console.warn('[GUIService] Failed to parse annotated elements JSON');
            }

            // Update last known coords for subsequent gui_click calls
            this.lastKnownCoords = { imageW: screenWidth, imageH: screenHeight, screenW: screenWidth, screenH: screenHeight };

            console.log(`[GUIService] Annotated screenshot: ${screenWidth}x${screenHeight}, ${elements.length} elements marked`);

            return {
                dataUrl: 'data:image/png;base64,' + base64,
                elements,
                screenWidth,
                screenHeight,
                cursorX,
                cursorY,
            };
        } catch (error: any) {
            if (error.name === 'AbortError') throw new Error('Annotated screenshot aborted by user');
            throw error;
        } finally {
            if (this.currentAbortController === controller) {
                this.currentAbortController = null;
            }
        }
    }

    /**
     * Enumerate desktop file icons via Shell.Application + SysListView32 LVM_GETITEMRECT.
     * Desktop icons are NOT visible to UIAutomation, so this uses Win32 SendMessage directly.
     * Returns icon names, paths, and center coordinates usable with gui_click / gui_double_click.
     */
    public async scanDesktopIcons(): Promise<Array<{ name: string; path: string; x: number; y: number; w: number; h: number }>> {
        try {
            const result = await this.runAction('desktopicons');
            if (!result || result === '[]' || result.startsWith('ERROR')) return [];
            const parsed = JSON.parse(result);
            const raw = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
            return raw.map((el: any) => {
                const center = this.toPhysicalCoords(el.x, el.y);
                const size = this.toPhysicalCoords(el.w, el.h);
                return {
                    name: el.name,
                    path: el.path,
                    x: center.x,
                    y: center.y,
                    w: size.x,
                    h: size.y
                };
            });
        } catch (err: any) {
            console.warn('[GUIService] scanDesktopIcons failed:', err.message);
            return [];
        }
    }

    /**
     * Write the double-ESC listener PowerShell script.
     * Polls GetAsyncKeyState(0x1B) every 30ms, detects two distinct physical key-down
     * edges within 500ms, then prints "EMERGENCY_STOP" to stdout.
     * Node.js only acts on this signal when escListeningEnabled === true (i.e. during
     * an active GUI operation), so programmatic ESC from gui_press_key is ignored.
     */
    private writeEscListenerScript() {
        const script = [
            '$ErrorActionPreference = "Stop"',
            ...this.getUtf8PowerShellPrelude(),
            '$cs = @\'',
            'using System;',
            'using System.Runtime.InteropServices;',
            'public class EscHook {',
            '    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);',
            '}',
            '\'@',
            'Add-Type -TypeDefinition $cs',
            '$lastEsc = [DateTime]::MinValue',
            '$wasDown = $false',
            'while ($true) {',
            '    $state = [EscHook]::GetAsyncKeyState(0x1B)',
            '    $isDown = ($state -band 0x8000) -ne 0',
            '    if ($isDown -and -not $wasDown) {',
            '        $now = [DateTime]::UtcNow',
            '        if (($now - $lastEsc).TotalMilliseconds -lt 500) {',
            '            Write-Output "EMERGENCY_STOP"',
            '            [Console]::Out.Flush()',
            '            $lastEsc = [DateTime]::MinValue',
            '        } else {',
            '            $lastEsc = $now',
            '        }',
            '    }',
            '    $wasDown = $isDown',
            '    Start-Sleep -Milliseconds 30',
            '}',
        ].join('\n');
        fs.writeFileSync(this.escListenerScriptPath, script, 'utf-8');
        console.log('[GUIService] ESC listener script written.');
    }

    /**
     * Start the background double-ESC listener process.
     * The process runs permanently and Node.js calls cancelCurrentOperation()
     * whenever double-ESC is detected, EXCEPT when we are programmatically
     * sending an ESC key press (to avoid false positives).
     */
    public startEscListener(): void {
        if (this.escListenerProcess) return; // already running
        try {
            const { spawn } = require('child_process');
            this.escListenerProcess = spawn('powershell.exe', [
                '-NoProfile', '-ExecutionPolicy', 'Bypass',
                '-File', this.escListenerScriptPath,
            ], { stdio: ['ignore', 'pipe', 'ignore'] });

            this.escListenerProcess.stdout.on('data', (data: Buffer) => {
                const msg = data.toString().trim();
                if (msg.includes('EMERGENCY_STOP') && this.escListeningEnabled) {
                    console.warn('[GUIService] 🚨 Emergency stop by double-ESC! Halting current action...');
                    this.emergencyAbortFlag = true;
                    this.escListeningEnabled = false;
                    this.cancelCurrentOperation();

                    try {
                        // Globally abort the LLM agent loop to prevent it from stealing control back
                        const { ChatOrchestrator } = require('./chat-orchestrator-ref.js');
                        if (ChatOrchestrator && ChatOrchestrator.abortAll) {
                            ChatOrchestrator.abortAll();
                        }
                    } catch (e) {
                        console.error('[GUIService] Failed to call ChatOrchestrator.abortAll:', e);
                    }
                }
            });

            this.escListenerProcess.on('exit', (code: number) => {
                console.log('[GUIService] ESC listener exited:', code);
                this.escListenerProcess = null;
            });

            console.log('[GUIService] Double-ESC listener started (PID:', this.escListenerProcess.pid, ')');
        } catch (err: any) {
            console.warn('[GUIService] Failed to start ESC listener:', err.message);
        }
    }

    /**
     * Returns true if the user triggered the double-ESC emergency stop.
     * While true, all GUI actions are blocked.
     */
    public isEmergencyAborted(): boolean {
        return this.emergencyAbortFlag;
    }

    /**
     * Reset the emergency abort flag, re-enabling GUI operations.
     * Should only be called when the user confirms it is safe to resume.
     */
    public resetEmergencyAbort(): void {
        this.emergencyAbortFlag = false;
        console.log('[GUIService] Emergency abort flag reset. GUI operations are re-enabled.');
    }

    /**
     * Cancel any currently-running GUI action (called when user presses STOP).
     */
    public cancelCurrentOperation(): void {
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
            console.log('[GUIService] Current GUI operation aborted by STOP');
        }
    }

    /**
     * Auto-scale coordinates from screenshot image pixels to system logical coordinates.
     * The agent always passes pixel coordinates as seen in the screenshot image.
     * This method maps them to the correct SetCursorPos coordinate space.
     *
     * When screenshot comes from our PowerShell script: image == logical (no scaling needed).
     * When screenshot comes from screenshot-desktop fallback: image == physical, screen == logical.
     */
    private toScreenCoords(x: number, y: number): { x: number; y: number } {
        const { imageW, imageH, screenW, screenH } = this.lastKnownCoords;
        if (imageW > 0 && screenW > 0 && (imageW !== screenW || imageH !== screenH)) {
            return {
                x: Math.round(x * screenW / imageW),
                y: Math.round(y * screenH / imageH)
            };
        }
        return { x: Math.round(x), y: Math.round(y) };
    }

    /**
     * Auto-scale coordinates from system logical coordinates to screenshot image pixels.
     * Use this when translating coordinates returned by Windows APIs (which are logical,
     * e.g. UIAutomation, GetCursorPos) back to image pixels for the AI.
     */
    private toPhysicalCoords(x: number, y: number): { x: number; y: number } {
        const { imageW, imageH, screenW, screenH } = this.lastKnownCoords;
        if (imageW > 0 && screenW > 0 && (imageW !== screenW || imageH !== screenH)) {
            return {
                x: Math.round(x * imageW / screenW),
                y: Math.round(y * imageH / screenH)
            };
        }
        return { x: Math.round(x), y: Math.round(y) };
    }

    /**
     * Run a GUI action via the PowerShell script.
     * Uses AbortController so the process is killed immediately when STOP is pressed.
     * Also blocked if emergencyAbortFlag is set (double-ESC was triggered).
     */
    private async runAction(...args: string[]): Promise<string> {
        // Block all actions while emergency stop is active
        if (this.emergencyAbortFlag) {
            throw new Error('GUI EMERGENCY STOP active (double-ESC pressed). Call gui_emergency_reset to resume.');
        }

        // Temporarily disable ESC interrupt ONLY when the action itself sends ESC keypresses
        // (gui_press_key with escape/esc/0x1b) so programmatic events don't trigger the abort.
        const action = args[0]?.toLowerCase() || '';
        const isEscKeyAction = action === 'key' && args.some(
            a => a && (a.toLowerCase() === 'escape' || a.toLowerCase() === 'esc' || a === '0x1B' || a === '{ESCAPE}')
        );
        if (isEscKeyAction) {
            this.escListeningEnabled = false;
        }

        const controller = new AbortController();
        this.currentAbortController = controller;
        try {
            const { stdout, stderr } = await execFileAsync('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', this.scriptPath,
                ...args
            ], { timeout: 20000, signal: controller.signal as any });

            if (stderr && stderr.trim()) {
                console.warn('[GUIService] PS stderr:', stderr.trim());
            }
            const result = stdout.trim();
            if (result.startsWith('ERROR:')) {
                throw new Error(result.substring(7));
            }
            return result;
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log('[GUIService] Action aborted by STOP button');
                throw new Error('GUI operation aborted by user');
            }
            console.error('[GUIService] Action failed:', error.message);
            throw error;
        } finally {
            if (isEscKeyAction) {
                this.escListeningEnabled = true; // re-open the gate after programmatic ESC
            }
            if (this.currentAbortController === controller) {
                this.currentAbortController = null;
            }
        }
    }

    /**
     * Get the LOGICAL screen coordinate space used by SetCursorPos in a DPI-unaware process.
     *
     * IMPORTANT: screenshot-desktop captures at physical pixels, but our PowerShell action
     * script is DPI-UNAWARE, so SetCursorPos expects LOGICAL coordinates.
     * getScreenInfo() must return the logical bounds so toScreenCoords() can correctly
     * scale from image-pixels → logical coords.
     */
    public async getScreenInfo(): Promise<{ width: number; height: number; scaleFactor: number }> {
        // Write a tiny helper script to avoid inline escaping issues.
        // DPI-UNAWARE process → Screen.PrimaryScreen.Bounds returns LOGICAL coords,
        // which is exactly what SetCursorPos expects.
        const helperPath = path.join(path.dirname(this.scriptPath), 'gui_screeninfo.ps1');
        const helperScript = [
            ...this.getUtf8PowerShellPrelude(),
            'Add-Type -AssemblyName System.Windows.Forms',
            '$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
            'Write-Output "$($s.Width),$($s.Height)"',
        ].join('\n');
        fs.writeFileSync(helperPath, helperScript, 'utf-8');
        try {
            const { stdout } = await execFileAsync('powershell.exe', [
                '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helperPath
            ], { timeout: 5000 });
            const parts = stdout.trim().split(',');
            const w = parseInt(parts[0]);
            const h = parseInt(parts[1]);
            if (w > 0 && h > 0) {
                console.log(`[GUIService] Logical screen coords (SetCursorPos space): ${w}x${h}`);
                return { width: w, height: h, scaleFactor: 1.0 };
            }
        } catch (err) {
            console.warn('[GUIService] Screen info query failed:', (err as Error).message);
        }
        console.warn('[GUIService] Screen info fallback: defaulting to 1920x1080');
        return { width: 1920, height: 1080, scaleFactor: 1.0 };
    }

    /**
     * Take a screenshot of the entire desktop at LOGICAL resolution.
     *
     * Uses PowerShell Graphics.CopyFromScreen in a DPI-unaware process.
     * This captures at the LOGICAL screen resolution (e.g. 1920x1080) — the same
     * coordinate space that SetCursorPos uses.
     *
     * Also overlays a red crosshair marker at the current mouse cursor position
     * so the AI can see exactly where the cursor is.
     */
    public async takeScreenshot(): Promise<ScreenshotResult> {
        // Run the dedicated screenshot PS1 file via execFileAsync.
        // This is abortable (same as runAction), and avoids the inline -Command
        // parsing issues that break when Add-Type contains quotes.
        const controller = new AbortController();
        this.currentAbortController = controller;

        try {
            const { stdout } = await execFileAsync('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', this.screenshotScriptPath,
            ], { timeout: 15000, maxBuffer: 50 * 1024 * 1024, signal: controller.signal as any });

            const raw = stdout.trim();
            if (!raw || raw.length < 100) throw new Error('Empty screenshot output from PS1');

            // Parse prefix: "physW,physH,cursorX,cursorY|base64"
            const pipeIdx = raw.indexOf('|');
            let cursorX: number | undefined;
            let cursorY: number | undefined;
            let base64 = raw;
            if (pipeIdx > 0 && pipeIdx < 40) {
                const parts = raw.substring(0, pipeIdx).split(',');
                // parts[0]=physW, parts[1]=physH, parts[2]=cursorX, parts[3]=cursorY
                cursorX = parseInt(parts[2]) || undefined;
                cursorY = parseInt(parts[3]) || undefined;
                base64 = raw.substring(pipeIdx + 1);
            }

            const imgBuffer = Buffer.from(base64, 'base64');

            // Read PNG IHDR chunk for dimensions (offset 16 = width, 20 = height)
            const imageWidth = imgBuffer.readUInt32BE(16);
            const imageHeight = imgBuffer.readUInt32BE(20);

            if (imageWidth < 100 || imageHeight < 100) {
                throw new Error(`PNG dimensions invalid: ${imageWidth}x${imageHeight}`);
            }

            // Physical screenshot = same coord space as GetPhysicalCursorPos → no scaling needed
            this.lastKnownCoords = { imageW: imageWidth, imageH: imageHeight, screenW: imageWidth, screenH: imageHeight };

            console.log(`[GUIService] Screenshot (physical PS1): ${imageWidth}x${imageHeight} cursor:(${cursorX},${cursorY})`);

            return {
                dataUrl: 'data:image/png;base64,' + base64,
                screenWidth: imageWidth,
                screenHeight: imageHeight,
                imageWidth,
                imageHeight,
                scaleFactor: 1.0,
                cursorX,
                cursorY
            };
        } catch (error: any) {
            if (error.name === 'AbortError') {
                throw new Error('Screenshot aborted by user');
            }
            // Fallback to screenshot-desktop if PS1 fails
            console.warn('[GUIService] PS1 screenshot failed, falling back to screenshot-desktop:', error.message);
            try {
                const screenInfo = await this.getScreenInfo();
                const imgBuffer = await (screenshot({ format: 'png' }) as Promise<Buffer>);
                const base64 = imgBuffer.toString('base64');
                const imageWidth = imgBuffer.readUInt32BE(16);
                const imageHeight = imgBuffer.readUInt32BE(20);
                this.lastKnownCoords = { imageW: imageWidth, imageH: imageHeight, screenW: screenInfo.width, screenH: screenInfo.height };
                console.log(`[GUIService] Fallback screenshot: image=${imageWidth}x${imageHeight}, logical_screen=${screenInfo.width}x${screenInfo.height}`);
                return {
                    dataUrl: 'data:image/png;base64,' + base64,
                    screenWidth: screenInfo.width,
                    screenHeight: screenInfo.height,
                    imageWidth,
                    imageHeight,
                    scaleFactor: screenInfo.scaleFactor
                };
            } catch (fallbackError) {
                throw new Error(`Screenshot failed: ${(fallbackError as Error).message}`);
            }
        } finally {
            if (this.currentAbortController === controller) {
                this.currentAbortController = null;
            }
        }
    }

    /**
     * Get the current mouse cursor position in logical screen coordinates.
     */
    public async getCursorPosition(): Promise<{ x: number; y: number }> {
        const result = await this.runAction('getpos');
        const parts = result.split(',');
        const logicalX = parseInt(parts[0]) || 0;
        const logicalY = parseInt(parts[1]) || 0;
        return this.toPhysicalCoords(logicalX, logicalY);
    }

    /**
     * Get a list of all visible top-level windows.
     */
    public async getWindowList(): Promise<WindowInfo[]> {
        const result = await this.runAction('getwindows');
        if (!result.trim()) return [];
        const lines = result.trim().split('\n').filter((l: string) => l.trim());
        return lines.map((line: string) => {
            const parts = line.split('|');
            return {
                title: parts[0] || '',
                process: parts[1] || '',
                x: parseInt(parts[2]) || 0,
                y: parseInt(parts[3]) || 0,
                width: parseInt(parts[4]) || 0,
                height: parseInt(parts[5]) || 0,
                isVisible: true
            };
        }).filter((w: WindowInfo) => w.title.trim());
    }

    /**
     * Scan the screen using Windows UI Automation to return all interactable
     * elements (buttons, inputs, lists, etc.) with their semantic names and
     * exact logical coordinates. Max 100 elements to keep response manageable.
     *
     * @param windowTitle Optional: filter to elements within a specific window title
     */
    public async scanScreenElements(windowTitle?: string): Promise<UIElement[]> {
        const result = await this.runAction('scanscreen', windowTitle || '');
        try {
            const parsed = JSON.parse(result);
            const raw: any[] = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
            // ConvertTo-Json uses 'w'/'h' keys — map to UIElement 'width'/'height'
            return raw.map((el: any): UIElement => {
                const center = this.toPhysicalCoords(Number(el.x) || 0, Number(el.y) || 0);
                const size = this.toPhysicalCoords(Number(el.w) || Number(el.width) || 0, Number(el.h) || Number(el.height) || 0);
                return {
                    type: String(el.type || ''),
                    name: String(el.name || ''),
                    x: center.x,
                    y: center.y,
                    width: size.x,
                    height: size.y,
                    enabled: Boolean(el.enabled !== false && el.enabled !== 'false'),
                    value: String(el.value || ''),
                };
            });
        } catch {
            console.error('[GUIService] Failed to parse scanscreen result:', result.substring(0, 200));
            return [];
        }
    }


    /**
     * Focus/activate a window by partial title match.
     */
    public async focusWindow(title: string): Promise<string> {
        return await this.runAction('focuswindow', title);
    }

    /**
     * Move mouse to given coordinates without clicking.
     */
    public async moveMouse(x: number, y: number): Promise<void> {
        const c = this.toScreenCoords(x, y);
        await this.runAction('move', String(c.x), String(c.y));
        console.log(`[GUIService] Mouse moved to (${c.x}, ${c.y}) [img:(${x},${y})]`);
    }

    public async clickMouse(x: number, y: number, button: string = 'left'): Promise<void> {
        const c = this.toScreenCoords(x, y);
        const action = button === 'right' ? 'rightclick' : 'click';
        await this.runAction(action, String(c.x), String(c.y));
        console.log(`[GUIService] Mouse ${button}-clicked at (${c.x}, ${c.y}) [img:(${x},${y})]`);
    }

    public async doubleClick(x: number, y: number): Promise<void> {
        const c = this.toScreenCoords(x, y);
        await this.runAction('doubleclick', String(c.x), String(c.y));
        console.log(`[GUIService] Mouse double-clicked at (${c.x}, ${c.y}) [img:(${x},${y})]`);
    }

    public async typeText(text: string): Promise<void> {
        await this.runAction('type', text);
        console.log(`[GUIService] Typed text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    }

    public async pressKey(key: string): Promise<void> {
        const parts = key.toLowerCase().split('+').map((k: string) => k.trim());

        const vkMap: Record<string, string> = {
            'enter': '0D', 'return': '0D', 'tab': '09',
            'escape': '1B', 'esc': '1B', 'space': '20',
            'backspace': '08', 'delete': '2E',
            'home': '24', 'end': '23', 'pageup': '21', 'pagedown': '22',
            'up': '26', 'down': '28', 'left': '25', 'right': '27',
            'ctrl': '11', 'control': '11', 'alt': '12', 'shift': '10',
            'win': '5B', 'windows': '5B', 'super': '5B',
            'f1': '70', 'f2': '71', 'f3': '72', 'f4': '73',
            'f5': '74', 'f6': '75', 'f7': '76', 'f8': '77',
            'f9': '78', 'f10': '79', 'f11': '7A', 'f12': '7B',
            'a': '41', 'b': '42', 'c': '43', 'd': '44',
            'e': '45', 'f': '46', 'g': '47', 'h': '48',
            'i': '49', 'j': '4A', 'k': '4B', 'l': '4C',
            'm': '4D', 'n': '4E', 'o': '4F', 'p': '50',
            'q': '51', 'r': '52', 's': '53', 't': '54',
            'u': '55', 'v': '56', 'w': '57', 'x': '58',
            'y': '59', 'z': '5A',
            '0': '30', '1': '31', '2': '32', '3': '33',
            '4': '34', '5': '35', '6': '36', '7': '37',
            '8': '38', '9': '39',
        };

        const extendedKeys = new Set(['delete', 'home', 'end', 'pageup', 'pagedown', 'up', 'down', 'left', 'right', 'win', 'windows', 'super']);

        const vks: string[] = [];
        const exts: string[] = [];
        for (const p of parts) {
            const vk = vkMap[p];
            if (!vk) throw new Error(`Unknown key: ${p}`);
            vks.push(vk);
            exts.push(extendedKeys.has(p) ? '1' : '0');
        }

        await this.runAction('key', vks.join(','), exts.join(','));
        console.log(`[GUIService] Pressed key: ${key}`);
    }

    public async scrollMouse(x: number, y: number, direction: string, amount: number = 3): Promise<void> {
        const c = this.toScreenCoords(x, y);
        const scrollAmount = direction === 'up' ? amount : -amount;
        await this.runAction('scroll', String(c.x), String(c.y), String(scrollAmount));
        console.log(`[GUIService] Scrolled ${direction} by ${amount} at (${c.x}, ${c.y}) [img:(${x},${y})]`);
    }

    public async dragMouse(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
        const f = this.toScreenCoords(fromX, fromY);
        const t = this.toScreenCoords(toX, toY);
        await this.runAction('drag', String(f.x), String(f.y), String(t.x), String(t.y));
        console.log(`[GUIService] Dragged from (${f.x},${f.y}) to (${t.x},${t.y}) [img:(${fromX},${fromY})→(${toX},${toY})]`);
    }
}

export const guiService = GUIService.getInstance();

