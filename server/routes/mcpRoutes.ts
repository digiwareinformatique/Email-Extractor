import { Router } from 'express';
import { digiwareMcp } from '../mcp/digiwareMcpClient';
import fs from 'fs';
import path from 'path';

export const mcpRouter = Router();

const LOCAL_PLUGIN_DIR = path.resolve(process.cwd(), 'cloned-wordpress-plugin/whatsapp');

// List local files of the extension in Workspace
mcpRouter.get('/local-extension-files', async (_req, res) => {
  try {
    if (!fs.existsSync(LOCAL_PLUGIN_DIR)) {
      return res.json({ success: true, files: [] });
    }

    const getAllFiles = (dir: string, baseDir: string): any[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let results: any[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          results = results.concat(getAllFiles(fullPath, baseDir));
        } else {
          const stats = fs.statSync(fullPath);
          results.push({
            name: entry.name,
            relPath,
            size: stats.size,
            mtime: stats.mtime
          });
        }
      }
      return results;
    };

    const files = getAllFiles(LOCAL_PLUGIN_DIR, LOCAL_PLUGIN_DIR);
    res.json({ success: true, count: files.length, files });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Read local file content from Workspace
mcpRouter.get('/local-file-content', async (req, res) => {
  try {
    const relPath = req.query.path as string;
    if (!relPath) {
      return res.status(400).json({ success: false, error: 'Path required' });
    }
    const fullPath = path.resolve(LOCAL_PLUGIN_DIR, relPath);
    if (!fullPath.startsWith(LOCAL_PLUGIN_DIR) || !fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, error: 'Fichier local introuvable' });
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    res.json({ success: true, relPath, content, lines: content.split('\n').length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Save edits to local file in Workspace
mcpRouter.post('/save-local-file', async (req, res) => {
  try {
    const { path: relPath, content } = req.body;
    if (!relPath || content === undefined) {
      return res.status(400).json({ success: false, error: 'path and content required' });
    }
    const fullPath = path.resolve(LOCAL_PLUGIN_DIR, relPath);
    if (!fullPath.startsWith(LOCAL_PLUGIN_DIR)) {
      return res.status(403).json({ success: false, error: 'Accès non autorisé' });
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    res.json({ success: true, message: `Fichier local ${relPath} sauvegardé avec succès.` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ⚡ DIRECT PUSH TO WORDPRESS SITE VIA MCP (files_write)
mcpRouter.post('/push-file-to-site', async (req, res) => {
  try {
    const { path: relPath, note } = req.body;
    if (!relPath) {
      return res.status(400).json({ success: false, error: 'path required' });
    }
    const fullPath = path.resolve(LOCAL_PLUGIN_DIR, relPath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, error: `Fichier local ${relPath} introuvable.` });
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    console.log(`[MCP Push] Envoi direct vers WordPress: plugins/whatsapp/${relPath}`);

    const result = await digiwareMcp.deployExtensionFile(
      relPath,
      content,
      note || `Mise à jour DigiWare Studio: ${relPath} [${new Date().toLocaleTimeString('fr-FR')}]`
    );

    res.json({
      success: true,
      message: `✅ Le fichier ${relPath} a été mis à jour directement sur l'extension WordPress via MCP !`,
      result
    });
  } catch (err: any) {
    console.error('[MCP Push Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Test connection and status
mcpRouter.get('/status', async (_req, res) => {
  try {
    const wooStatus = await digiwareMcp.getWooStatus();
    res.json({
      connected: true,
      endpoint: 'https://digiwareinformatique.com/wp-json/digiware/v2/mcp',
      wooStatus
    });
  } catch (err: any) {
    res.status(500).json({
      connected: false,
      error: err.message
    });
  }
});

// Full site information
mcpRouter.get('/site-info', async (_req, res) => {
  try {
    const info = await digiwareMcp.getSiteInfo();
    res.json({ success: true, info });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List all 98 available tools
mcpRouter.get('/tools', async (_req, res) => {
  try {
    const tools = await digiwareMcp.listTools();
    res.json({ success: true, total: tools.length, tools });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// WooCommerce status
mcpRouter.get('/woo/status', async (_req, res) => {
  try {
    const data = await digiwareMcp.getWooStatus();
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// WooCommerce customers
mcpRouter.get('/woo/customers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 25;
    const customers = await digiwareMcp.getWooCustomers(limit);
    res.json({ success: true, data: customers });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Read remote file from WordPress
mcpRouter.get('/read-file', async (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      return res.status(400).json({ success: false, error: 'Path parameter required' });
    }
    const result = await digiwareMcp.readFile(filePath);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Call any arbitrary read tool (with safety check in digiwareMcp.callTool)
mcpRouter.post('/tool-call', async (req, res) => {
  try {
    const { tool, args } = req.body;
    if (!tool) {
      return res.status(400).json({ error: 'Missing tool name' });
    }
    const result = await digiwareMcp.callTool(tool, args || {});
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
