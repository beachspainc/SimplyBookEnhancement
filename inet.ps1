# 获取主活动网卡（非虚拟、非 Wi-Fi）
$adapter = Get-NetAdapter | Where-Object {
    $_.Status -eq "Up" -and $_.LinkSpeed -gt 0 -and
    $_.InterfaceDescription -notmatch "VMware|Virtual|Loopback|Wi-Fi Direct|Bluetooth"
} | Sort-Object LinkSpeed -Descending | Select-Object -First 1

if ($adapter) {
    Write-Host "`n✅ [已连接主网卡]" -ForegroundColor Green
    $adapter | Format-Table Name, InterfaceDescription, Status, LinkSpeed, MacAddress -AutoSize

    # 获取 IP 配置
    $ip = Get-NetIPConfiguration -InterfaceAlias $adapter.Name

    Write-Host "`n🌐 [IP 配置]" -ForegroundColor Cyan
    Write-Host "IPv4: $($ip.IPv4Address.IPAddress)"
    Write-Host "网关: $($ip.IPv4DefaultGateway.NextHop)"
    Write-Host "DNS : $($ip.DnsServer.ServerAddresses -join ', ')"

    # 判断公网还是私网
    if ($ip.IPv4Address.IPAddress -match '^10\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[01])\.') {
        Write-Host "📡 当前为【私网IP】，处于 NAT 后面。" -ForegroundColor Yellow
    } else {
        Write-Host "🌍 当前为【公网IP】，有公网访问权限！" -ForegroundColor Green
    }

    # 网卡速率判断
    $speed = $adapter.LinkSpeed.ToString()
    if ($speed -match "2\.5 Gbps|5 Gbps|10 Gbps") {
        Write-Host "`n🔌 网卡当前连接速率：$speed，支持高带宽！"
        Write-Host "🟢 如果想跑满，建议配合 Cat6 或 Cat6a 网线。"
    } elseif ($speed -match "1 Gbps") {
        Write-Host "`n💡 当前连接速率为千兆（1 Gbps）。"
        Write-Host "✅ Cat5e 网线可满足，但建议 Cat6 以上更稳。"
    } elseif ($speed -match "100 Mbps") {
        Write-Host "`n⚠️ 当前仅百兆速率，可能网线老旧或端口限制。" -ForegroundColor Red
        Write-Host "建议检查是否使用老旧 Cat5 网线或设备不支持千兆。"
    }

    # 额外输出：网卡名称判断支持 2.5G
    if ($adapter.InterfaceDescription -match "I225|I226|AQC") {
        Write-Host "✅ 网卡为高端型号，支持 2.5G/5G Ethernet。"
    }

} else {
    Write-Host "❌ 没有检测到已连接的有线网卡。" -ForegroundColor Red
}

# 试图获取路由器信息
Write-Host "`n🧠 [路由器检测尝试]" -ForegroundColor Magenta
$gw = (Get-NetRoute -DestinationPrefix "0.0.0.0/0" | Where-Object {$_.NextHop -ne "::"} | Sort-Object RouteMetric | Select-Object -First 1).NextHop
if ($gw) {
    try {
        $sysinfo = Invoke-WebRequest -Uri "http://$gw" -UseBasicParsing -TimeoutSec 3
        if ($sysinfo.Content -match "Technicolor|Arris|Netgear|Asus|TP-Link|CGM4981|XB7|XB8") {
            $line = ($sysinfo.RawContent -split "`n" | Select-String "Technicolor|Arris|Netgear|Asus|TP-Link|XB7|XB8").Line
            Write-Host "🔍 可能路由器厂商/型号: $line"
        } else {
            Write-Host "已访问网关页面，但未识别出厂商关键词。"
        }
    } catch {
        Write-Host "⚠️ 无法访问路由器管理页面（可能是运营商锁定或登录验证）。"
    }
} else {
    Write-Host "未找到默认网关。"
}
