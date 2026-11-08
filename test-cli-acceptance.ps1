# Northbridge University Demo - Acceptance Test (CLI Fallback)
# Uses project-local agent-browser CLI dependency in a fresh named session

param(
    [string]$Port = $env:PORT,
    [string]$SessionId
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not $Port) { $Port = '4317' }
$targetUrl = "http://127.0.0.1:$Port/"

$browser = '.\node_modules\.bin\agent-browser.cmd'
if (-not (Test-Path $browser)) {
    throw "agent-browser CLI not found at $browser. Run npm.cmd ci first."
}

if (-not $SessionId) {
    $session = 'northbridge-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
} else {
    $session = $SessionId
}

$browserArgs = @('--session', $session, '--allowed-domains', '127.0.0.1')

function Invoke-BrowserCli([string[]]$cmdArgs) {
    & $browser @cmdArgs
    if ($LASTEXITCODE -ne 0) {
        throw "agent-browser CLI command failed with exit code $LASTEXITCODE. Arguments: $($cmdArgs -join ' ')"
    }
}

function Invoke-BrowserSnapshot([string[]]$cmdArgs) {
    $output = & $browser @cmdArgs
    if ($LASTEXITCODE -ne 0) {
        throw "agent-browser snapshot failed with exit code $LASTEXITCODE. Arguments: $($cmdArgs -join ' ')"
    }
    return ($output -join "`n")
}

function Parse-Ref($text, $pattern) {
    if ($text -match "$pattern\s+\[.*?ref=([a-zA-Z0-9_-]+)\]") {
        return "@" + $Matches[1]
    }
    throw "Could not find ref for pattern: $pattern in snapshot text"
}

$sessionStarted = $false
$sessionClosed = $false
$failureMessage = $null
$checkpointInvocations = 0
$cleanupInvocations = 0
$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host "Starting CLI acceptance task in fresh session '$session' against $targetUrl..."

try {
    # Step 1: Open catalogue
    $checkpointInvocations++
    Write-Host "Step 1: Open catalogue..."
    Invoke-BrowserCli ($browserArgs + @('open', $targetUrl))
    $sessionStarted = $true

    # Step 1b: Observe catalogue
    $checkpointInvocations++
    $s1 = Invoke-BrowserSnapshot ($browserArgs + @('snapshot', '-c', '-s', '#main'))
    Write-Host "Step 1b: Catalogue snapshot observed."
    $refMSc = Parse-Ref $s1 'link "MSc Applied Data Science"'

    # Step 2: Navigate to Programme
    $checkpointInvocations++
    Write-Host "Step 2: Navigate to MSc Applied Data Science..."
    Invoke-BrowserCli ($browserArgs + @('click', $refMSc))

    # Step 2b: Observe programme & deadline
    $checkpointInvocations++
    $s2 = Invoke-BrowserSnapshot ($browserArgs + @('snapshot', '-c', '-s', '#main'))
    Write-Host "Step 2b: Programme snapshot observed."
    if ($s2 -match '21 May 2027') {
        Write-Host "  -> VERIFIED: Application deadline is 21 May 2027"
    } else {
        throw "Application deadline '21 May 2027' not found in programme snapshot"
    }
    $refStartDraft = Parse-Ref $s2 'link "Start a draft application"'

    # Step 3: Open Draft form
    $checkpointInvocations++
    Write-Host "Step 3: Open draft application form..."
    Invoke-BrowserCli ($browserArgs + @('click', $refStartDraft))

    # Step 3b: Observe form fields
    $checkpointInvocations++
    $s3 = Invoke-BrowserSnapshot ($browserArgs + @('snapshot', '-c', '-s', '#main'))
    Write-Host "Step 3b: Initial draft form observed."
    $refName = Parse-Ref $s3 'textbox "Full name"'
    $refEmail = Parse-Ref $s3 'textbox "Email address"'
    $refQual = Parse-Ref $s3 'textbox "Previous qualification"'

    # Step 4: Fill form fields
    $checkpointInvocations += 3
    Write-Host "Step 4: Fill form fields with synthetic applicant..."
    Invoke-BrowserCli ($browserArgs + @('fill', $refName, 'Avery Example'))
    Invoke-BrowserCli ($browserArgs + @('fill', $refEmail, 'avery@example.test'))
    Invoke-BrowserCli ($browserArgs + @('fill', $refQual, 'BSc Statistics'))

    # Step 5: Scoped observation of populated form
    $checkpointInvocations++
    $s4 = Invoke-BrowserSnapshot ($browserArgs + @('snapshot', '-c', '-s', 'form'))
    Write-Host "Step 5: Scoped observation of populated form observed."

    # Strict field-label and value verification on populated form
    $hasName = ($s4 -match 'textbox "Full name"[^\n]*:\s*Avery Example') -or ($s4 -match 'Full name.*Avery Example')
    $hasEmail = ($s4 -match 'textbox "Email address"[^\n]*:\s*avery@example\.test') -or ($s4 -match 'Email address.*avery@example\.test')
    $hasQual = ($s4 -match 'textbox "Previous qualification"[^\n]*:\s*BSc Statistics') -or ($s4 -match 'Previous qualification.*BSc Statistics')

    if (-not ($hasName -and $hasEmail -and $hasQual)) {
        throw "Populated form verification failed: labels and values do not match expected inputs in scoped snapshot."
    }
    Write-Host "  -> VERIFIED: All three form labels and values verified in populated form."
    $refSave = Parse-Ref $s4 'button "Save draft"'

    # Step 6: Save once
    $checkpointInvocations++
    Write-Host "Step 6: Click Save draft..."
    Invoke-BrowserCli ($browserArgs + @('click', $refSave))

    # Step 6b: Observe My drafts
    $checkpointInvocations++
    $s5 = Invoke-BrowserSnapshot ($browserArgs + @('snapshot', '-c', '-s', '#main'))
    Write-Host "Step 6b: My drafts snapshot observed."
    if ($s5 -match 'Draft saved\.') {
        Write-Host "  -> VERIFIED: 'Draft saved.' confirmed."
    } else {
        throw "Draft saved confirmation failed in drafts snapshot."
    }
    $refOpenDraft = Parse-Ref $s5 'link "Open MSc Applied Data Science draft"'

    # Step 7: Follow record link to review
    $checkpointInvocations++
    Write-Host "Step 7: Follow record link to review..."
    Invoke-BrowserCli ($browserArgs + @('click', $refOpenDraft))

    # Step 7b: Observe Review saved draft
    $checkpointInvocations++
    $s6 = Invoke-BrowserSnapshot ($browserArgs + @('snapshot', '-c', '-s', '#main'))
    Write-Host "Step 7b: Review saved draft snapshot observed."

    # Strict status field verification: match the ENTIRE line value following "Status:"
    if ($s6 -match 'Status:\s*([^"\r\n]+)') {
        $observedStatus = $Matches[1].Replace('"', '').Replace("'", '').Trim()
        if ($observedStatus -ne 'Draft') {
            throw "Review status verification failed: expected exactly 'Draft', but observed '$observedStatus'"
        }
    } else {
        throw "Status field 'Status: <value>' not found on review page snapshot"
    }

    if (-not ($s6 -match 'Review saved draft' -and $s6 -match 'MSc Applied Data Science')) {
        throw "Review header or programme verification failed"
    }

    $reviewNameMatch = $s6 -match 'Full name[\s\S]*?Avery Example'
    $reviewEmailMatch = $s6 -match 'Email address[\s\S]*?avery@example\.test'
    $reviewQualMatch = $s6 -match 'Previous qualification[\s\S]*?BSc Statistics'

    if (-not ($reviewNameMatch -and $reviewEmailMatch -and $reviewQualMatch)) {
        throw "Review field verification failed: persisted applicant values do not match field labels"
    }

    $sw.Stop()

    Write-Host "`n============================================="
    Write-Host "HUMAN REVIEW CHECKPOINT REACHED AND VERIFIED:"
    Write-Host "- Programme: MSc Applied Data Science"
    Write-Host "- Status: $observedStatus (verified exact value: Draft)"
    Write-Host "- Full name: Avery Example"
    Write-Host "- Email address: avery@example.test"
    Write-Host "- Previous qualification: BSc Statistics"
    Write-Host "============================================="

    # Normal cleanup: close ONLY this test's named session
    $cleanupInvocations++
    Invoke-BrowserCli @('--session', $session, 'close')
    $sessionClosed = $true

    # Compute snapshot payload size (normalized UTF-8 bytes)
    $snapshots = @($s1, $s2, $s3, $s4, $s5, $s6)
    $totalBytes = 0
    foreach ($s in $snapshots) {
        $norm = $s.Replace("`r`n", "`n")
        $totalBytes += [System.Text.Encoding]::UTF8.GetByteCount($norm)
    }

    Write-Host "`nMETRICS SUMMARY (PowerShell CLI Fallback Run):"
    Write-Host "Elapsed wall-clock time: $($sw.ElapsedMilliseconds) ms ($([math]::Round($sw.ElapsedMilliseconds / 1000, 2)) s)"
    Write-Host "CLI invocations through review checkpoint: $checkpointInvocations"
    Write-Host "CLI cleanup invocations: $cleanupInvocations"
    Write-Host "Total CLI invocations: $($checkpointInvocations + $cleanupInvocations)"
    Write-Host "Page observations: 6"
    Write-Host "Observation payload size (normalized UTF-8 bytes): $totalBytes"
    Write-Host "Failures / retries: 0"
}
catch {
    $failureMessage = $_.Exception.Message
    Write-Host "`nCLI workflow failed: $failureMessage" -ForegroundColor Red
}
finally {
    # Failure-path cleanup: close ONLY this test's named session if still active
    if ($sessionStarted -and -not $sessionClosed) {
        Write-Host "Performing failure-path cleanup for session '$session'..."
        try {
            & $browser --session $session close
        } catch {
            Write-Warning "Session cleanup notice (non-fatal): $_"
        }
    }
    if ($failureMessage) {
        exit 1
    }
}
