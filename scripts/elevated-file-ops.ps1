$ErrorActionPreference = 'Stop'
$planPath = $args[0]
$plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
$completed = @()
try {
    # Preflight every destination before changing any installed file.
    foreach ($op in $plan.operations) {
        $destination = [string]$op.destination
        if ($op.action -eq 'install') {
            if ((Test-Path -LiteralPath $destination) -and -not [bool]$op.overwrite) {
                throw "UNMANAGED_EXISTS: $destination"
            }
        } elseif ($op.action -eq 'uninstall') {
            if (Test-Path -LiteralPath $destination) {
                $actual = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($actual -ne ([string]$op.sha256).ToLowerInvariant()) { throw "MODIFIED_FILE: $destination" }
            }
        } else { throw 'Unknown operation' }
    }

    foreach ($op in $plan.operations) {
        $destination = [string]$op.destination
        $parent = Split-Path -Parent $destination
        $backup = $null
        if ($op.action -eq 'install') {
            New-Item -ItemType Directory -Force -Path $parent | Out-Null
            $suffix = [Guid]::NewGuid().ToString('N')
            $temp = "$destination.vtx-tmp-$suffix"
            Copy-Item -LiteralPath ([string]$op.source) -Destination $temp -Force
            $actual = (Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne ([string]$op.sha256).ToLowerInvariant()) { throw "HASH_MISMATCH: $destination" }
            if (Test-Path -LiteralPath $destination) {
                $backup = "$destination.vtx-backup-$suffix"
                Move-Item -LiteralPath $destination -Destination $backup
            }
            $completed += [pscustomobject]@{ action='install'; destination=$destination; backup=$backup }
            Move-Item -LiteralPath $temp -Destination $destination -Force
        } elseif ($op.action -eq 'uninstall') {
            if (Test-Path -LiteralPath $destination) {
                $suffix = [Guid]::NewGuid().ToString('N')
                $backup = "$destination.vtx-backup-$suffix"
                Move-Item -LiteralPath $destination -Destination $backup
                $completed += [pscustomobject]@{ action='uninstall'; destination=$destination; backup=$backup }
            }
        }
    }
    foreach ($item in $completed) {
        if ($item.backup -and (Test-Path -LiteralPath $item.backup)) { Remove-Item -LiteralPath $item.backup -Force }
        if ($item.action -eq 'uninstall') {
            $parent = Split-Path -Parent $item.destination
            if (Test-Path -LiteralPath $parent) {
                if (-not (Get-ChildItem -LiteralPath $parent -Force | Select-Object -First 1)) { Remove-Item -LiteralPath $parent -Force }
            }
        }
    }
    exit 0
} catch {
    for ($i = $completed.Count - 1; $i -ge 0; $i--) {
        $item = $completed[$i]
        if ($item.action -eq 'install') {
            if (Test-Path -LiteralPath $item.destination) { Remove-Item -LiteralPath $item.destination -Force }
            Get-ChildItem -LiteralPath (Split-Path -Parent $item.destination) -Filter ((Split-Path -Leaf $item.destination) + '.vtx-tmp-*') -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
        }
        if ($item.backup -and (Test-Path -LiteralPath $item.backup)) { Move-Item -LiteralPath $item.backup -Destination $item.destination -Force }
    }
    foreach ($op in $plan.operations) {
        $parent = Split-Path -Parent ([string]$op.destination)
        $leaf = Split-Path -Leaf ([string]$op.destination)
        if (Test-Path -LiteralPath $parent) {
            Get-ChildItem -LiteralPath $parent -Filter ($leaf + '.vtx-tmp-*') -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
        }
    }
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
