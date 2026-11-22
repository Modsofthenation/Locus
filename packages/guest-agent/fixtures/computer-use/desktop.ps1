param([string]$OutputDirectory)
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object Windows.Forms.Form
$form.Text = 'Locus computer-use fixture'
$text = New-Object Windows.Forms.TextBox
$text.AccessibleName = 'Document text'
$text.Dock = 'Top'
$button = New-Object Windows.Forms.Button
$button.Text = 'Save document'
$button.Dock = 'Bottom'
$button.Add_Click({
  $dialog = New-Object Windows.Forms.SaveFileDialog
  $dialog.Title = 'Save fixture'
  $dialog.InitialDirectory = $OutputDirectory
  $dialog.FileName = 'result.txt'
  if ($dialog.ShowDialog($form) -eq 'OK') { [IO.File]::WriteAllText($dialog.FileName,$text.Text) }
  $dialog.Dispose()
})
$form.Controls.Add($text)
$form.Controls.Add($button)
[void]$form.ShowDialog()
