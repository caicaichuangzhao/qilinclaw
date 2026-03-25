@echo off
REM 等待5分钟（300秒）
timeout /t 300 /nobreak >nul

REM 5分钟后弹出消息框
powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('⏰ 提醒时间到！\n\n该载孩子上学了！', '上学提醒', 'OK', 'Warning')"
