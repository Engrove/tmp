using System;
using System.Diagnostics;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using PresenceLock.Core;

namespace PresenceLock.App.Ui
{
    /// <summary>
    /// "Om PresenceLock": a modal dialog opened from the tray menu. The text comes from
    /// <see cref="AboutContent"/> (built from the settings in force), so it cannot drift from
    /// what the agent actually does. Opens nothing but the user's own data folder and, if the
    /// administrator configured one, an http(s)/UNC link to the full privacy notice.
    /// </summary>
    internal sealed class AboutForm : Form
    {
        private readonly AboutInfo _info;
        private readonly string _dataFolder;

        public AboutForm(AboutInfo info, string dataFolder)
        {
            _info = info;
            _dataFolder = dataFolder;
            var sections = AboutContent.Build(info);

            Text = AboutContent.Title;
            Icon = SystemIcons.Shield;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = true;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            ClientSize = new Size(680, 600);
            Font = SystemFonts.MessageBoxFont;
            KeyPreview = true;
            KeyDown += (s, e) => { if (e.KeyCode == Keys.Escape) Close(); };

            // ---- header ----------------------------------------------------------------
            var header = new Panel { Dock = DockStyle.Top, Height = 72, Padding = new Padding(16, 12, 16, 8), BackColor = SystemColors.Window };
            var icon = new PictureBox { Image = SystemIcons.Shield.ToBitmap(), SizeMode = PictureBoxSizeMode.CenterImage, Size = new Size(40, 48), Dock = DockStyle.Left };
            var title = new Label
            {
                Text = sections[0].Heading,
                Font = new Font(Font.FontFamily, Font.Size * 1.6f, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(64, 10)
            };
            var who = new Label { Text = "Ansvarig: " + info.Responsible, AutoSize = true, Location = new Point(66, 44) };
            header.Controls.Add(title);
            header.Controls.Add(who);
            header.Controls.Add(icon);

            // ---- body: all sections, headings in bold -----------------------------------
            var body = new RichTextBox
            {
                Dock = DockStyle.Fill,
                ReadOnly = true,
                BorderStyle = BorderStyle.None,
                BackColor = SystemColors.Window,
                DetectUrls = true,
                ScrollBars = RichTextBoxScrollBars.Vertical,
                TabStop = false
            };
            var bold = new Font(Font, FontStyle.Bold);
            for (int i = 0; i < sections.Count; i++)
            {
                var sec = sections[i];
                if (i > 0)
                {
                    body.SelectionFont = bold;
                    body.AppendText(sec.Heading + Environment.NewLine);
                }
                // The responsible person is already in the header: do not repeat it in the body.
                string text = i == 0
                    ? string.Join("\n", sec.Body.Split('\n').Where(l => !l.StartsWith("Ansvarig:", StringComparison.Ordinal)))
                    : sec.Body;
                body.SelectionFont = Font;
                body.AppendText(text.Replace("\n", Environment.NewLine) + Environment.NewLine + Environment.NewLine);
            }
            body.SelectionStart = 0;
            body.LinkClicked += (s, e) => OpenLink(e.LinkText);
            var bodyHost = new Panel { Dock = DockStyle.Fill, Padding = new Padding(16, 8, 8, 8), BackColor = SystemColors.Window };
            bodyHost.Controls.Add(body);

            // ---- buttons ---------------------------------------------------------------
            var buttons = new FlowLayoutPanel
            {
                Dock = DockStyle.Bottom,
                FlowDirection = FlowDirection.RightToLeft,
                Height = 48,
                Padding = new Padding(8)
            };
            var close = new Button { Text = "Stäng", AutoSize = true, DialogResult = DialogResult.OK };
            var data = new Button { Text = "Öppna mina data", AutoSize = true };
            data.Click += (s, e) => OpenDataFolder();
            var copy = new Button { Text = "Kopiera text", AutoSize = true };
            copy.Click += (s, e) => { try { Clipboard.SetText(AboutContent.AsText(sections)); } catch (Exception) { } };
            buttons.Controls.Add(close);
            if (!string.IsNullOrEmpty(info.PolicyUrl))
            {
                var policy = new Button { Text = "Dataskyddsbeskrivning", AutoSize = true };
                policy.Click += (s, e) => OpenLink(info.PolicyUrl);
                buttons.Controls.Add(policy);
            }
            buttons.Controls.Add(data);
            buttons.Controls.Add(copy);
            AcceptButton = close;
            CancelButton = close;

            Controls.Add(bodyHost);
            Controls.Add(new Label { Dock = DockStyle.Bottom, Height = 1, BorderStyle = BorderStyle.Fixed3D });
            Controls.Add(buttons);
            Controls.Add(header);
        }

        private void OpenDataFolder()
        {
            try
            {
                System.IO.Directory.CreateDirectory(_dataFolder);
                Process.Start(new ProcessStartInfo("explorer.exe", "\"" + _dataFolder + "\"") { UseShellExecute = false });
            }
            catch (Exception ex) { MessageBox.Show(this, "Mappen kunde inte öppnas: " + ex.Message, Text); }
        }

        /// <summary>Only the configured privacy-notice link or plain http(s) links are opened.</summary>
        private void OpenLink(string link)
        {
            bool web = link.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || link.StartsWith("http://", StringComparison.OrdinalIgnoreCase);
            if (!web && !string.Equals(link, _info.PolicyUrl, StringComparison.Ordinal)) return;
            try { Process.Start(new ProcessStartInfo(link) { UseShellExecute = true }); }
            catch (Exception ex) { MessageBox.Show(this, "Länken kunde inte öppnas: " + ex.Message, Text); }
        }
    }
}
