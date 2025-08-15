'==========================================
' excel_monitor.vbs  —— 模块化 Excel 监听器
'==========================================
Option Explicit

'========== 配置 ==========
Const CFG_WB_PATH     = ""             ' 可留空=当前激活工作簿；或指定绝对路径
Const CFG_STORE_SHEET = "Store"        ' VeryHidden 日志表名
Const CFG_POLL_MS     = 500            ' 主循环休眠间隔（毫秒）

Const xlSheetVisible     = -1
Const xlSheetHidden      = 0
Const xlSheetVeryHidden  = 2
Const xlUp               = -4162

'========== 全局 ==========
Dim gXL        ' Excel.Application
Dim gWB        ' 目标 Workbook
Dim gStore     ' VeryHidden 日志 Worksheet
Dim gTblState  ' 每个工作表的表集合快照（Scripting.Dictionary）
Dim gRunning   ' 主循环开关
Dim gReentry   ' 防重入（写日志时避免触发事件）

'========== 入口 ==========
Main

'==========================
' 主流程（入口）
'==========================
Sub Main()
    Set gXL = GetOrStartExcel()
    HookAppEvents gXL

    Set gWB = GetTargetWorkbook(gXL, CFG_WB_PATH)
    If gWB Is Nothing Then
        WScript.Echo "未能获取工作簿。"
        Exit Sub
    End If

    Set gStore = EnsureStoreSheet(gWB, CFG_STORE_SHEET)
    Set gTblState = SnapshotAllTables(gWB, CFG_STORE_SHEET)

    gRunning = True
    Do While gRunning
        WScript.Sleep CFG_POLL_MS
    Loop

    UnhookAppEvents gXL
End Sub

'==========================
' Excel 连接 / 事件挂载
'==========================
Function GetOrStartExcel()
    On Error Resume Next
    Dim app: Set app = GetObject(, "Excel.Application")
    If Err.Number <> 0 Then
        Err.Clear
        Set app = CreateObject("Excel.Application")
        app.Visible = True
    End If
    On Error GoTo 0
    Set GetOrStartExcel = app
End Function

Function GetTargetWorkbook(app, path)
    On Error Resume Next
    Dim wb
    If Len(path) > 0 Then
        Set wb = app.Workbooks.Open(path)
    Else
        If app.Workbooks.Count = 0 Then app.Workbooks.Add
        Set wb = app.ActiveWorkbook
    End If
    On Error GoTo 0
    Set GetTargetWorkbook = wb
End Function

Sub HookAppEvents(app)
    WScript.ConnectObject app, "App"
End Sub

Sub UnhookAppEvents(app)
    On Error Resume Next
    WScript.DisconnectObject app
    On Error GoTo 0
End Sub

'==========================
' 隐藏日志表 / 日志写入
'==========================
Function EnsureStoreSheet(wb, storeName)
    Dim ws
    On Error Resume Next
    Set ws = wb.Worksheets(storeName)
    On Error GoTo 0

    If ws Is Nothing Then
        Set ws = wb.Worksheets.Add
        ws.Name = storeName
        ws.Range("A1:E1").Value = Array("Time","Event","Sheet","Name/Addr","More")
        ws.Columns("A:E").EntireColumn.AutoFit
    End If

    ws.Visible = xlSheetVeryHidden
    Set EnsureStoreSheet = ws
End Function

Sub LogEvent(ev, shName, nameOrAddr, moreInfo)
    If gReentry Then Exit Sub
    gReentry = True
    On Error Resume Next

    Dim ws: Set ws = gStore
    Dim r:  r = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row + 1

    ws.Cells(r, 1).Value = Now
    ws.Cells(r, 2).Value = ev
    ws.Cells(r, 3).Value = shName
    ws.Cells(r, 4).Value = nameOrAddr
    ws.Cells(r, 5).Value = moreInfo

    On Error GoTo 0
    gReentry = False
End Sub

'==========================
' 表（ListObjects）快照与对比
'==========================
Function SnapshotAllTables(wb, storeName)
    Dim dict: Set dict = CreateObject("Scripting.Dictionary")
    Dim ws
    For Each ws In wb.Worksheets
        If ws.Name <> storeName Then
            dict(ws.Name) = SnapshotTablesOnSheet(ws)
        End If
    Next
    Set SnapshotAllTables = dict
End Function

Function SnapshotTablesOnSheet(ws)
    Dim d: Set d = CreateObject("Scripting.Dictionary")
    Dim lo
    For Each lo In ws.ListObjects
        d(lo.Name) = True
    Next
    Set SnapshotTablesOnSheet = d
End Function

Sub CheckTables(ws)
    If TypeName(ws) <> "Worksheet" Then Exit Sub
    If ws.Name = CFG_STORE_SHEET Then Exit Sub

    Dim d, current, lo, k, exists
    If gTblState.Exists(ws.Name) Then
        Set d = gTblState(ws.Name)
    Else
        Set d = CreateObject("Scripting.Dictionary")
        gTblState.Add ws.Name, d
    End If

    Set current = CreateObject("Scripting.Dictionary")
    For Each lo In ws.ListObjects
        current(lo.Name) = lo
        If Not d.Exists(lo.Name) Then
            d(lo.Name) = True
            LogEvent "TableCreated", ws.Name, lo.Name, lo.Range.Address(False, False)
        End If
    Next

    For Each k In d.Keys
        exists = current.Exists(k)
        If Not exists Then
            d.Remove k
            LogEvent "TableDeleted", ws.Name, k, ""
        End If
    Next
End Sub


Sub AppSheetChange(Sh, Target)
    On Error Resume Next
    If Sh Is Nothing Then Exit Sub
    If Sh.Parent.Name <> gWB.Name Then Exit Sub
    If Sh.Name = CFG_STORE_SHEET Then Exit Sub
    LogEvent "Edit", Sh.Name, Target.Address(False, False), ""
    CheckTables Sh
End Sub

Sub AppWorkbookNewSheet(Wb, Sh)
    On Error Resume Next
    If Wb Is Nothing Then Exit Sub
    If Wb.Name <> gWB.Name Then Exit Sub
    LogEvent "NewSheet", Sh.Name, "", ""
    gTblState(Sh.Name) = SnapshotTablesOnSheet(Sh)
End Sub

Sub AppSheetActivate(Sh)
    On Error Resume Next
    If Sh Is Nothing Then Exit Sub
    If Sh.Parent.Name <> gWB.Name Then Exit Sub
    CheckTables Sh
End Sub

Sub AppWorkbookBeforeClose(Wb, Cancel)
    On Error Resume Next
    If Wb Is Nothing Then Exit Sub
    If gWB Is Nothing Then Exit Sub
    If Wb.Name = gWB.Name Then
        gRunning = False
    End If
End Sub
