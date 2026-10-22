Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "D:\mini-14"
sh.Run """D:\mini-14\runtime\node\node.exe"" ""D:\mini-14\tools\train-service.mjs""", 0, False