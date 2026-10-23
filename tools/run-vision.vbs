Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "D:\mini-14"
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""D:\mini-14\tools\start-vision.ps1""", 0, False