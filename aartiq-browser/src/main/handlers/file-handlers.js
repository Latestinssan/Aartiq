const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

module.exports = function registerFileHandlers(ipcMain, handlers) {
  const { mainWindow, store, wifiSyncService } = handlers;

  function sendFileToConnectedMobile(filePath, filename, mimeType) {
    try {
      if (!wifiSyncService) return;
      const fileBuffer = fs.readFileSync(filePath);
      wifiSyncService.sendFileToMobile(filename, fileBuffer, mimeType, {
        source: 'document-generation',
      });
    } catch (err) {
      console.warn('[FileHandlers] Failed to send file to mobile:', err.message);
    }
  }

  ipcMain.handle('read-file-buffer', async (event, filePath) => {
    try {
      const buffer = await fs.promises.readFile(filePath);
      return buffer.buffer;
    } catch (error) { return new ArrayBuffer(0); }
  });

  ipcMain.handle('select-local-file', async (event, options = {}) => {
    const { dialog } = require('electron');
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: options.directory ? ['openDirectory'] : ['openFile'],
      filters: options.filters || [{ name: 'All Files', extensions: ['*'] }]
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });

  ipcMain.handle('open-file', async (event, filePath) => {
    const { shell } = require('electron');
    try { await shell.openPath(filePath); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('scan-folder', async (event, folderPath, types) => {
    const { scanDirectoryRecursive } = require('./utils.js');
    return await scanDirectoryRecursive(folderPath, types);
  });

  ipcMain.handle('save-persistent-data', async (event, { key, data }) => {
    store.set(`persistent_${key}`, data);
    // The renderer mirrors the Firebase config here so the main process can
    // initialize Firebase (config only lives in renderer localStorage).
    // Reinitialize so CloudSync/P2P pick it up.
    if (key === 'firebase-config' && data) {
      try {
        require('../../lib/FirebaseService').default.reinitialize();
      } catch (e) {
        console.warn('[Firebase] Reinitialize after config mirror failed:', e.message);
      }
    }
    return { success: true };
  });

  ipcMain.handle('load-persistent-data', async (event, key) => {
    const data = store.get(`persistent_${key}`);
    return data !== undefined ? { success: true, data } : { success: false };
  });

  ipcMain.handle('delete-persistent-data', async (event, key) => {
    store.delete(`persistent_${key}`);
    return { success: true };
  });

  ipcMain.handle('get-onboarding-state', () => ({
    completed: store.get('onboarding_completed') || false,
    step: store.get('onboarding_step') || 0,
  }));

  ipcMain.handle('set-onboarding-state', (event, partial = {}) => {
    if (partial.completed !== undefined) store.set('onboarding_completed', partial.completed);
    if (partial.step !== undefined) store.set('onboarding_step', partial.step);
    return { success: true };
  });

  ipcMain.handle('load-skill', async (event, format) => {
    const { skillLoader } = require('../../lib/SkillLoader.js');
    try { const skill = await skillLoader.load(format); return { success: true, skill }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  const { getAppIconBase64 } = require('./utils.js');
  const { generateAartiqPDFTemplate } = require('./pdf-utils.js');

  ipcMain.handle('generate-pdf', async (event, title, content) => {
    const { BrowserWindow, app } = require('electron');
    const os = require('os');
    try {
      const pdfTitle = title || 'Aartiq Document';
      const cleanContent = content || '';
      const icon = await getAppIconBase64();
      const html = generateAartiqPDFTemplate(pdfTitle, cleanContent, icon);

      const downloadsPath = app.getPath('downloads');
      let workerWindow = null;
      let tempHtmlPath = '';

      try {
        const tempDir = os.tmpdir();
        tempHtmlPath = path.join(tempDir, `aartiq_pdf_${Date.now()}.html`);
        fs.writeFileSync(tempHtmlPath, html, 'utf8');

        workerWindow = new BrowserWindow({
          width: 900, height: 1200, show: false,
          webPreferences: { offscreen: true, partition: 'persist:pdf' }
        });

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('PDF load timeout')), 30000);
          workerWindow.webContents.once('did-finish-load', () => {
            clearTimeout(timeout);
            resolve();
          });
          workerWindow.webContents.once('did-fail-load', (e, err) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to load: ${err}`));
          });
          workerWindow.loadFile(tempHtmlPath).catch(reject);
        });

        const pdfData = await workerWindow.webContents.printToPDF({
          printBackground: true, pageSize: 'A4',
          margins: { top: 0, bottom: 0, left: 0, right: 0 }
        });

        const safeName = pdfTitle.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
        const filePath = path.join(downloadsPath, `${safeName}_${Date.now()}.pdf`);
        fs.writeFileSync(filePath, pdfData);

        const finalName = path.basename(filePath);
        mainWindow.webContents.send('download-started', { name: finalName, path: filePath });
        setTimeout(() => {
          mainWindow.webContents.send('download-progress', { name: finalName, progress: 100 });
          mainWindow.webContents.send('download-complete', { name: finalName, path: filePath });
        }, 500);

        sendFileToConnectedMobile(filePath, finalName, 'application/pdf');

        return { success: true, filePath };
      } finally {
        if (workerWindow && !workerWindow.isDestroyed()) workerWindow.destroy();
        if (tempHtmlPath && fs.existsSync(tempHtmlPath)) try { fs.unlinkSync(tempHtmlPath); } catch (e) {}
      }
    } catch (err) {
      console.error('[Generate-PDF] Failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('generate-xlsx', async (event, options) => {
    const { app } = require('electron');
    const XLSX = require('xlsx');
    try {
      const { title, pages, sheets, content } = options || {};
      const workbook = XLSX.utils.book_new();

      function markdownToRows(text) {
        const rows = [];
        if (!text) return rows;
        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
          if (line.match(/^[-|=]+$/)) continue;
          if (line.includes('|')) {
            const cells = line.split('|').map(c => c.trim()).filter(Boolean);
            if (cells.length > 0) rows.push(cells);
          } else {
            rows.push([line.trim()]);
          }
        }
        return rows;
      }

      function flattenSections(page) {
        if (page.content) return page.content;
        if (Array.isArray(page.sections)) {
          return page.sections.map(s => {
            const parts = [];
            if (s.title) parts.push(`## ${s.title}`);
            if (s.content) parts.push(s.content);
            return parts.join('\n\n');
          }).join('\n\n');
        }
        return '';
      }

      if (sheets && Array.isArray(sheets)) {
        for (const sheet of sheets) {
          const ws = XLSX.utils.aoa_to_sheet(sheet.data || [['No Data']]);
          XLSX.utils.book_append_sheet(workbook, ws, sheet.name || 'Sheet1');
        }
      } else if (pages && Array.isArray(pages)) {
        for (const page of pages) {
          const pageContent = flattenSections(page);
          const rows = markdownToRows(pageContent);
          const ws = XLSX.utils.aoa_to_sheet(rows.length > 0 ? rows : [['No Data']]);
          XLSX.utils.book_append_sheet(workbook, ws, (page.title || 'Sheet1').substring(0, 31));
        }
      } else if (content) {
        const rows = markdownToRows(content);
        const ws = XLSX.utils.aoa_to_sheet(rows.length > 0 ? rows : [['No Data']]);
        XLSX.utils.book_append_sheet(workbook, ws, (title || 'Sheet1').substring(0, 31));
      } else {
        const ws = XLSX.utils.aoa_to_sheet([['No Data Provided']]);
        XLSX.utils.book_append_sheet(workbook, ws, 'Sheet1');
      }

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      const downloadsPath = app.getPath('downloads');
      const safeName = (title || 'Aartiq_Document').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
      const filePath = require('path').join(downloadsPath, `${safeName}_${Date.now()}.xlsx`);
      fs.writeFileSync(filePath, buffer);

      sendFileToConnectedMobile(filePath, require('path').basename(filePath), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return { success: true, filePath };
    } catch (err) {
      console.error('[Generate-XLSX] Failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('generate-docx', async (event, options) => {
    const { app } = require('electron');
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
    try {
      const { title, pages, content } = options || {};
      const docSections = [];

      function flattenSections(page) {
        if (page.content) return page.content;
        if (Array.isArray(page.sections)) {
          return page.sections.map(s => {
            const parts = [];
            if (s.title) parts.push(`## ${s.title}`);
            if (s.content) parts.push(s.content);
            return parts.join('\n\n');
          }).join('\n\n');
        }
        return '';
      }

      function parseMarkdownToParagraphs(text) {
        if (!text) return [];
        const paragraphs = [];
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('# ')) {
            paragraphs.push(new Paragraph({ text: line.replace(/^#+\s*/, ''), heading: HeadingLevel.HEADING_1 }));
          } else if (line.startsWith('## ')) {
            paragraphs.push(new Paragraph({ text: line.replace(/^#+\s*/, ''), heading: HeadingLevel.HEADING_2 }));
          } else if (line.startsWith('### ')) {
            paragraphs.push(new Paragraph({ text: line.replace(/^#+\s*/, ''), heading: HeadingLevel.HEADING_3 }));
          } else if (line.match(/^[-*]\s+/)) {
            const text = line.replace(/^[-*]\s+/, '');
            const runs = parseInlineFormatting(text);
            paragraphs.push(new Paragraph({ children: runs, bullet: { level: 0 } }));
          } else if (line.match(/^\d+\.\s+/)) {
            const text = line.replace(/^\d+\.\s+/, '');
            const runs = parseInlineFormatting(text);
            paragraphs.push(new Paragraph({ children: runs, numbering: { reference: 'default-numbering', level: 0 } }));
          } else if (line.trim()) {
            const runs = parseInlineFormatting(line);
            paragraphs.push(new Paragraph({ children: runs }));
          }
        }
        return paragraphs;
      }

      function parseInlineFormatting(text) {
        const runs = [];
        const regex = /(\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|`(.+?)`)/g;
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            runs.push(new TextRun(text.slice(lastIndex, match.index)));
          }
          if (match[2] || match[3]) {
            runs.push(new TextRun({ text: match[2] || match[3], bold: true }));
          } else if (match[4] || match[5]) {
            runs.push(new TextRun({ text: match[4] || match[5], italics: true }));
          } else if (match[6]) {
            runs.push(new TextRun({ text: match[6], font: 'Courier New' }));
          }
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < text.length) {
          runs.push(new TextRun(text.slice(lastIndex)));
        }
        if (runs.length === 0) runs.push(new TextRun(text));
        return runs;
      }

      if (pages && Array.isArray(pages)) {
        for (const page of pages) {
          const pageContent = flattenSections(page);
          const children = [];
          if (page.title) {
            children.push(new Paragraph({ text: page.title, heading: HeadingLevel.HEADING_1 }));
          }
          children.push(...parseMarkdownToParagraphs(pageContent));
          if (children.length === 0) {
            children.push(new Paragraph(''));
          }
          docSections.push({ children });
        }
      } else if (content) {
        docSections.push({ children: parseMarkdownToParagraphs(content) });
      } else {
        docSections.push({ children: [new Paragraph('No content provided')] });
      }

      // Add tagline to the last section
      if (docSections.length > 0) {
        const lastSection = docSections[docSections.length - 1];
        lastSection.children.push(new Paragraph({ text: '' }));
        lastSection.children.push(new Paragraph({
          text: 'For the questions that matter.',
          alignment: AlignmentType.CENTER,
          spacing: { before: 400 },
          children: [new TextRun({ text: 'For the questions that matter.', italics: true, color: '999999', size: 18 })]
        }));
      }

      const doc = new Document({
        sections: docSections,
        numbering: {
          config: [
            {
              reference: 'default-numbering',
              levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT }]
            }
          ]
        }
      });
      const buffer = await Packer.toBuffer(doc);
      const downloadsPath = app.getPath('downloads');
      const safeName = (title || 'Aartiq_Document').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
      const filePath = require('path').join(downloadsPath, `${safeName}_${Date.now()}.docx`);
      fs.writeFileSync(filePath, buffer);

      sendFileToConnectedMobile(filePath, require('path').basename(filePath), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      return { success: true, filePath };
    } catch (err) {
      console.error('[Generate-DOCX] Failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('generate-pptx', async (event, options) => {
    const { app } = require('electron');
    const PptxGenJS = require('pptxgenjs');
    try {
      const { title, pages, slides, content } = options || {};
      const pptx = new PptxGenJS();
      pptx.title = title || 'Aartiq Presentation';
      pptx.author = 'Aartiq AI';

      function flattenSections(item) {
        if (item.content) return item.content;
        if (Array.isArray(item.sections)) {
          return item.sections.map(s => {
            const parts = [];
            if (s.title) parts.push(s.title);
            if (s.content) parts.push(s.content);
            return parts.join('\n\n');
          }).join('\n\n');
        }
        return '';
      }

      function addSlideContent(pptx, slideTitle, text, notes) {
        const slide = pptx.addSlide();
        if (slideTitle) {
          slide.addText(slideTitle, { x: 0.5, y: 0.3, w: 9, fontSize: 28, bold: true, color: '333333' });
        }
        if (text) {
          const lines = text.split('\n').filter(l => l.trim());
          const textItems = lines.map(line => ({
            text: line.replace(/^[-•*]\s*/, ''),
            options: { bullet: line.match(/^[-•*]\s/) ? true : undefined, breakType: 'none' }
          }));
          slide.addText(textItems, { x: 0.5, y: slideTitle ? 1.2 : 0.5, w: 9, h: slideTitle ? 4 : 5.2, fontSize: 16, color: '444444', valign: 'top' });
        }
        // Tagline footer
        slide.addText('For the questions that matter.', { x: 0.5, y: 5.1, w: 9, fontSize: 8, color: 'AAAAAA', italic: true, align: 'center' });
        if (notes) {
          slide.addNotes(notes);
        }
      }

      const slideData = slides || pages || [];

      if (slideData.length > 0) {
        for (const item of slideData) {
          const itemContent = flattenSections(item);
          addSlideContent(pptx, item.title || '', itemContent, item.notes);
        }
      } else if (content) {
        const sections = content.split(/\n---\n/);
        for (const section of sections) {
          const lines = section.trim().split('\n');
          const heading = lines[0]?.startsWith('# ') ? lines[0].replace(/^#+\s*/, '') : '';
          const body = heading ? lines.slice(1).join('\n').trim() : section.trim();
          addSlideContent(pptx, heading || title || 'Slide', body);
        }
      } else {
        const slide = pptx.addSlide();
        slide.addText('No content provided', { x: 1, y: 1, fontSize: 24, color: '666666' });
      }

      const downloadsPath = app.getPath('downloads');
      const safeName = (title || 'Aartiq_Presentation').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
      const filePath = require('path').join(downloadsPath, `${safeName}_${Date.now()}.pptx`);
      const buffer = await pptx.write({ outputType: 'nodebuffer' });
      fs.writeFileSync(filePath, buffer);

      sendFileToConnectedMobile(filePath, require('path').basename(filePath), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      return { success: true, filePath };
    } catch (err) {
      console.error('[Generate-PPTX] Failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('export-chat-txt', async (event, content) => {
    const { app, dialog } = require('electron');
    const downloadsPath = app.getPath('downloads');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Chat History',
      defaultPath: path.join(downloadsPath, `comet-chat-${Date.now()}.txt`),
      filters: [{ name: 'Text Files', extensions: ['txt'] }]
    });
    if (!canceled && filePath) {
      fs.writeFileSync(filePath, content);
      mainWindow.webContents.send('download-started', { name: path.basename(filePath), path: filePath });
      return { success: true };
    }
    return { success: false, error: 'Canceled' };
  });

  ipcMain.handle('export-chat-pdf', async (event, messages) => {
    const { BrowserWindow, dialog, app } = require('electron');
    const os = require('os');

    try {
      // Build chat content from messages
      let chatContent = '';
      let chatTitle = 'Chat Session Export';

      if (Array.isArray(messages)) {
        for (const msg of messages) {
          const role = msg.role === 'user' ? 'You' : (msg.role === 'assistant' ? 'Aartiq' : msg.role);
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          chatContent += `**${role}:** ${content}\n\n`;
        }
        if (messages.length > 0) {
          chatTitle = `Chat Export - ${new Date().toLocaleDateString()}`;
        }
      } else if (typeof messages === 'string') {
        chatContent = messages;
      }

      const iconBase64 = await getAppIconBase64();
      const pdfHtml = generateAartiqPDFTemplate(chatTitle, chatContent, iconBase64, {
        author: 'Aartiq',
        category: 'Chat Session',
        tags: ['chat', 'export', 'aartiq'],
        watermark: 'CONFIDENTIAL'
      });

      const downloadsPath = app.getPath('downloads');
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Chat as PDF',
        defaultPath: path.join(downloadsPath, `comet-chat-${Date.now()}.pdf`),
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      });

      if (!canceled && filePath) {
        let workerWindow = null;
        let tempHtmlPath = '';
        try {
          const tempDir = os.tmpdir();
          tempHtmlPath = path.join(tempDir, `aartiq_export_${Date.now()}.html`);
          fs.writeFileSync(tempHtmlPath, pdfHtml, 'utf8');

          workerWindow = new BrowserWindow({
            width: 900, height: 1200, show: false,
            webPreferences: { offscreen: true, partition: 'persist:pdf' }
          });

          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('PDF load timeout')), 30000);
            workerWindow.webContents.once('did-finish-load', () => {
              clearTimeout(timeout);
              resolve();
            });
            workerWindow.webContents.once('did-fail-load', (e, err) => {
              clearTimeout(timeout);
              reject(new Error(`Failed to load: ${err}`));
            });
            workerWindow.loadFile(tempHtmlPath).catch(reject);
          });

          const pdfData = await workerWindow.webContents.printToPDF({
            printBackground: true, pageSize: 'A4',
            margins: { top: 0, bottom: 0, left: 0, right: 0 }
          });

          fs.writeFileSync(filePath, pdfData);
          const finalName = path.basename(filePath);
          mainWindow.webContents.send('download-started', { name: finalName, path: filePath });
          setTimeout(() => {
            mainWindow.webContents.send('download-progress', { name: finalName, progress: 100 });
            mainWindow.webContents.send('download-complete', { name: finalName, path: filePath });
          }, 500);

          return { success: true, path: filePath };
        } finally {
          if (workerWindow && !workerWindow.isDestroyed()) workerWindow.destroy();
          if (tempHtmlPath && fs.existsSync(tempHtmlPath)) try { fs.unlinkSync(tempHtmlPath); } catch (e) { }
        }
      }
      return { success: false, error: 'Canceled' };
    } catch (err) {
      console.error('[Export-PDF] Failed:', err);
      return { success: false, error: err.message };
    }
  });

  const { protocol, net } = require('electron');
  try {
    protocol.handle('media', (request) => {
      const filePath = decodeURIComponent(request.url.replace('media://', ''));
      return net.fetch(`file://${path.normalize(filePath)}`);
    });
  } catch (e) {
    console.warn('[Handlers] media protocol already registered or failed');
  }

  console.log('[Handlers] File handlers registered');
};