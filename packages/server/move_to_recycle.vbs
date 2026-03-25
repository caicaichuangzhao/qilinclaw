Set objShell = CreateObject("Shell.Application")
Set objFolder = objShell.Namespace(0)
Set objFolderItem = objFolder.ParseName("1.txt")
If Not objFolderItem Is Nothing Then
    Set objDestFolder = objShell.Namespace(10)
    objDestFolder.MoveHere objFolderItem
End If