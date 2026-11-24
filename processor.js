'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PYTHON = 'D:\\TripoSR\\environment\\Scripts\\python.exe';
const RUN_SCRIPT = 'D:\\TripoSR\\source\\run.py';

module.exports = async function(input, params, context) {
  const imagePath = input && input.filePath;

  if (!imagePath || !fs.existsSync(imagePath)) {
    throw new Error('Input image is missing or does not exist.');
  }

  if (!fs.existsSync(PYTHON) || !fs.existsSync(RUN_SCRIPT)) {
    throw new Error('TripoSR installation was not found at the configured paths.');
  }

  const workspace = context.workspaceDir;
  if (!workspace || !fs.existsSync(workspace)) {
    throw new Error('Modly workspace directory is unavailable.');
  }

  const nodeId = String(context.nodeId || input.nodeId || 'node')
    .replace(/[^a-zA-Z0-9_-]/g, '_');

  const outputDir = path.join(
    workspace,
    'TripoSR',
    `${Date.now()}_${nodeId}`
  );

  fs.mkdirSync(outputDir, { recursive: true });

  const resolution = Number(params.mc_resolution) || 256;
  const chunkSize = Number(params.chunk_size) || 4096;
  const textureResolution = Number(params.texture_resolution) || 2048;

  if (resolution < 64 || resolution > 512) {
    throw new Error('Geometry resolution must be between 64 and 512.');
  }

  if (chunkSize < 512 || chunkSize > 8192) {
    throw new Error('Chunk size must be between 512 and 8192.');
  }

  const args = [
    RUN_SCRIPT,
    imagePath,
    '--device', 'cuda:0',
    '--mc-resolution', String(resolution),
    '--chunk-size', String(chunkSize),
    '--no-remove-bg',
    '--model-save-format', 'glb',
    '--output-dir', outputDir
  ];

  if (params.texture_mode === 'baked_texture') {
    args.push('--bake-texture');
    args.push('--texture-resolution', String(textureResolution));
  }

  context.log(`Starting TripoSR at resolution ${resolution}.`);
  context.progress(5, 'Starting TripoSR');

  await new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, {
      windowsHide: true,
      shell: false
    });

    let stderr = '';
    let stdout = '';
    let settled = false;

    child.stdout.on('data', chunk => {
      const value = chunk.toString();
      stdout += value;
      context.log(value.trim());
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on('close', code => {
      if (settled) return;
      settled = true;

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(
          `TripoSR exited with code ${code}.\n${stderr.slice(-6000)}\n${stdout.slice(-2000)}`
        ));
      }
    });
  });

  const meshPath = path.join(outputDir, '0', 'mesh.glb');

  if (!fs.existsSync(meshPath)) {
    throw new Error(`TripoSR finished but mesh.glb was not found in ${outputDir}.`);
  }

  context.progress(100, 'GLB generated');
  context.log(`Generated mesh: ${meshPath}`);

  return { filePath: meshPath };
};
