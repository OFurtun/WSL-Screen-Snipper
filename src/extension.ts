import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let screenshotDir: string | undefined;
let disposables: vscode.Disposable[] = [];
let fileWatcher: fs.FSWatcher | undefined;
let knownFiles: Set<string> = new Set();
let pollingInterval: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('WSL Screen Snipper extension activated');

    // Register command for manual screenshot saving
    const saveImageCommand = vscode.commands.registerCommand('wslScreenSnipper.saveImage', async () => {
        const windowsScreenshotsPath = getWindowsScreenshotsPath();
        if (!fs.existsSync(windowsScreenshotsPath)) {
            vscode.window.showErrorMessage(`Windows Screenshots directory not found: ${windowsScreenshotsPath}`);
            return;
        }
        
        // Find the most recent screenshot
        const files = fs.readdirSync(windowsScreenshotsPath)
            .filter(f => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'))
            .map(f => ({
                name: f,
                path: path.join(windowsScreenshotsPath, f),
                mtime: fs.statSync(path.join(windowsScreenshotsPath, f)).mtime
            }))
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
            
        if (files.length > 0) {
            await copyScreenshotToWSL(files[0].path);
        } else {
            vscode.window.showWarningMessage('No screenshots found in Windows Screenshots folder');
        }
    });

    disposables.push(saveImageCommand);
    context.subscriptions.push(saveImageCommand);

    // Register command to revert to default settings
    const revertToDefaultsCommand = vscode.commands.registerCommand('wslScreenSnipper.revertToDefaults', async () => {
        const result = await vscode.window.showWarningMessage(
            'Are you sure you want to revert all WSL Screen Snipper settings to their defaults? This action cannot be undone.',
            { modal: true },
            'Yes, Revert to Defaults',
            'Cancel'
        );

        if (result === 'Yes, Revert to Defaults') {
            await revertSettingsToDefaults();
        }
    });

    disposables.push(revertToDefaultsCommand);
    context.subscriptions.push(revertToDefaultsCommand);

    // Initial setup
    initializeMonitoring();

    // Re-initialize when settings change (no reload required)
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('wslScreenSnipper')) {
                console.log('Settings changed, reinitializing...');
                stopMonitoring();
                initializeMonitoring();
            }
        })
    );

    // Setup cleanup on deactivation
    context.subscriptions.push({
        dispose: () => {
            cleanup();
        }
    });

    // Additional cleanup hooks for various termination scenarios
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('beforeExit', cleanup);
    
    // Store cleanup reference for forced cleanup
    (global as any).wslScreenSnipperCleanup = cleanup;
}

function initializeMonitoring() {
    let setupSuccess = false;
    let monitoringSuccess = false;

    setupScreenshotDirectory().then(() => {
        console.log('Screenshot directory setup completed');
        setupSuccess = true;
        if (setupSuccess && monitoringSuccess) {
            vscode.window.showInformationMessage('WSL Screen Snipper: Ready! Screenshot monitoring active');
        }
    }).catch((error) => {
        console.error('Failed to setup screenshot directory:', error);
        vscode.window.showErrorMessage(`WSL Screen Snipper: Failed to setup screenshot directory - ${error}`);
    });

    try {
        if (startFileMonitoring()) {
            console.log('File monitoring started successfully');
            monitoringSuccess = true;
            if (setupSuccess && monitoringSuccess) {
                vscode.window.showInformationMessage('WSL Screen Snipper: Ready! Screenshot monitoring active');
            }
        } else {
            vscode.window.showWarningMessage('WSL Screen Snipper: File monitoring could not start - check Screenshots directory');
        }
    } catch (error) {
        console.error('Failed to start file monitoring:', error);
        vscode.window.showErrorMessage(`WSL Screen Snipper: Failed to start file monitoring - ${error}`);
    }
}

function stopMonitoring() {
    if (fileWatcher) {
        fileWatcher.close();
        fileWatcher = undefined;
    }
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = undefined;
    }
    knownFiles.clear();
}

async function setupScreenshotDirectory() {
    const config = vscode.workspace.getConfiguration('wslScreenSnipper');
    
    // First try temp folder name (default/preferred method)
    const tempFolderName = config.get<string>('tempFolderName', '').trim();
    console.log(`Temp folder name: "${tempFolderName}"`);
    
    if (tempFolderName) {
        // Use workspace directory with folder name
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            console.error('Temp folder name specified but no workspace folder open');
            vscode.window.showErrorMessage(
                'WSL Screen Snipper: Temp folder name requires an open workspace. ' +
                'Either open a workspace or use Custom Temp Path.'
            );
            return;
        }
        
        screenshotDir = path.join(workspaceFolder.uri.fsPath, `.${tempFolderName}`);
        console.log(`✓ Using workspace temp folder: ${screenshotDir}`);
    } else {
        // Fallback to custom temp path
        const customTempPath = config.get<string>('customTempPath', '').trim();
        console.log(`Custom temp path: "${customTempPath}"`);
        
        if (customTempPath) {
            screenshotDir = customTempPath;
            console.log(`✓ Using custom temp path: ${screenshotDir}`);
        } else {
            console.error('No temp directory configured');
            vscode.window.showErrorMessage(
                'WSL Screen Snipper: Please configure either Temp Folder Name or Custom Temp Path in settings.'
            );
            return;
        }
    }
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        console.log(`Created screenshot directory: ${screenshotDir}`);
    }
    
    // Add to gitignore if requested
    const addToGitignore = config.get<boolean>('addToGitignore', false);
    
    if (addToGitignore) {
        const isWorkspaceTemp = !!tempFolderName; // true if using workspace temp folder
        await addTempDirToGitignore(screenshotDir!, isWorkspaceTemp ? 'default' : 'custom');
    }
}

function getWindowsScreenshotsPath(): string {
    const config = vscode.workspace.getConfiguration('wslScreenSnipper');
    
    console.log(`=== Windows Path Detection Debug ===`);
    
    // First try Windows username (default/preferred method)
    const windowsUsername = config.get<string>('windowsUsername', '').trim();
    console.log(`Windows username: "${windowsUsername}"`);
    
    if (windowsUsername) {
        const screenshotsPath = `/mnt/c/Users/${windowsUsername}/Pictures/Screenshots`;
        console.log(`✓ Using username-based path: ${screenshotsPath}`);
        return screenshotsPath;
    }
    
    // Fallback to custom path
    const customPath = config.get<string>('customWindowsPath', '').trim();
    console.log(`Custom path: "${customPath}"`);
    
    if (customPath) {
        console.log(`✓ Using custom path: ${customPath}`);
        return customPath;
    }
    
    // No configuration provided
    console.error('✗ No Windows path configured');
    vscode.window.showErrorMessage(
        'WSL Screen Snipper: Please configure either Windows Username or Custom Windows Path in settings.'
    );
    return '';
}

async function revertSettingsToDefaults() {
    const config = vscode.workspace.getConfiguration('wslScreenSnipper');
    
    try {
        // Revert all settings to their defaults
        await config.update('windowsUsername', undefined, vscode.ConfigurationTarget.Global);
        await config.update('customWindowsPath', undefined, vscode.ConfigurationTarget.Global);
        await config.update('tempFolderName', 'Temp-Session-Snips', vscode.ConfigurationTarget.Global);
        await config.update('customTempPath', undefined, vscode.ConfigurationTarget.Global);
        await config.update('autoCleanup', true, vscode.ConfigurationTarget.Global);
        await config.update('addToGitignore', false, vscode.ConfigurationTarget.Global);
        
        console.log('Settings reverted to defaults');
        vscode.window.showInformationMessage('WSL Screen Snipper settings have been reverted to defaults. Please reload the window for changes to take effect.');
        
        // Offer to reload window
        const reloadResult = await vscode.window.showInformationMessage(
            'Would you like to reload the window now to apply the default settings?',
            'Reload Window',
            'Later'
        );
        
        if (reloadResult === 'Reload Window') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
        
    } catch (error) {
        console.error('Failed to revert settings to defaults:', error);
        vscode.window.showErrorMessage(`Failed to revert settings: ${error}`);
    }
}

async function addTempDirToGitignore(screenshotDir: string, tempPathType: string) {
    // Find the workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        console.log('No workspace folder found, cannot add to .gitignore');
        return;
    }
    
    const workspaceRoot = workspaceFolder.uri.fsPath;
    const gitignorePath = path.join(workspaceRoot, '.gitignore');
    
    let ignoreEntry: string;
    
    if (tempPathType === 'default') {
        // For default paths, use relative path from workspace root
        const relativePath = path.relative(workspaceRoot, screenshotDir);
        ignoreEntry = `${relativePath}/`;
    } else {
        // For custom paths, check if it's inside workspace
        const relativePath = path.relative(workspaceRoot, screenshotDir);
        
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            // Custom path is outside workspace, cannot add to this workspace's .gitignore
            console.log(`Custom temp path ${screenshotDir} is outside workspace, cannot add to .gitignore`);
            vscode.window.showInformationMessage(
                'Temp directory is outside workspace. .gitignore entry not added. ' +
                'Consider managing .gitignore manually if needed.'
            );
            return;
        } else {
            // Custom path is inside workspace, use relative path
            ignoreEntry = `${relativePath}/`;
        }
    }
    
    try {
        let gitignoreContent = '';
        if (fs.existsSync(gitignorePath)) {
            gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
        }
        
        // Check if entry already exists
        if (!gitignoreContent.includes(ignoreEntry)) {
            const newContent = gitignoreContent + (gitignoreContent.endsWith('\n') ? '' : '\n') + ignoreEntry + '\n';
            fs.writeFileSync(gitignorePath, newContent);
            console.log(`Added ${ignoreEntry} to .gitignore`);
            vscode.window.showInformationMessage(`Added ${ignoreEntry} to .gitignore`);
        } else {
            console.log(`${ignoreEntry} already exists in .gitignore`);
        }
    } catch (error) {
        console.error('Failed to update .gitignore:', error);
        vscode.window.showWarningMessage(`Failed to update .gitignore: ${error}`);
    }
}

async function copyScreenshotToWSL(sourceFile: string): Promise<string | undefined> {
    if (!screenshotDir) {
        // This shouldn't happen since setupScreenshotDirectory should have been called
        console.error('Screenshot directory not initialized');
        vscode.window.showErrorMessage('Screenshot directory not initialized');
        return;
    }

    try {
        const fileName = path.basename(sourceFile);
        const targetPath = path.join(screenshotDir, fileName);

        // Copy file from Windows to WSL
        fs.copyFileSync(sourceFile, targetPath);

        // Await clipboard write so notification means "ready to paste"
        await vscode.env.clipboard.writeText(targetPath);
        console.log(`Clipboard set: ${targetPath}`);

        vscode.window.showInformationMessage(`Screenshot ready: ${fileName} — Ctrl+V to paste path`);

        return targetPath;
    } catch (error) {
        vscode.window.showErrorMessage(`Error copying screenshot: ${error}`);
        return undefined;
    }
}


function startFileMonitoring(): boolean {
    const windowsScreenshotsPath = getWindowsScreenshotsPath();

    if (!windowsScreenshotsPath) {
        console.error('Windows Screenshots path not configured');
        return false;
    }

    if (!fs.existsSync(windowsScreenshotsPath)) {
        console.error(`Windows Screenshots directory not found: ${windowsScreenshotsPath}`);
        vscode.window.showErrorMessage(`Screenshots directory not found: ${windowsScreenshotsPath}. Please check your Windows username setting.`);
        return false;
    }

    // Snapshot existing filenames so we only detect NEW screenshots
    knownFiles = new Set(
        fs.readdirSync(windowsScreenshotsPath)
            .filter(f => /\.(png|jpe?g)$/i.test(f))
    );
    console.log(`Snapshotted ${knownFiles.size} existing screenshots`);

    try {
        fileWatcher = fs.watch(windowsScreenshotsPath, async (eventType, filename) => {
            if (filename && /\.(png|jpe?g)$/i.test(filename) && !knownFiles.has(filename)) {
                knownFiles.add(filename);
                const fullPath = path.join(windowsScreenshotsPath, filename);
                // Small delay to ensure file is fully written
                setTimeout(() => handleNewScreenshot(fullPath), 500);
            }
        });
        console.log(`fs.watch started for: ${windowsScreenshotsPath}`);
    } catch (error) {
        console.warn(`fs.watch failed: ${error}`);
    }

    // Polling fallback — single readdirSync per cycle, no stat calls
    const config = vscode.workspace.getConfiguration('wslScreenSnipper');
    const pollingMs = config.get<number>('pollingInterval', 500);

    pollingInterval = setInterval(async () => {
        await checkForNewScreenshots(windowsScreenshotsPath);
    }, pollingMs);

    console.log(`Polling started (${pollingMs}ms) for: ${windowsScreenshotsPath}`);
    return true;
}

async function checkForNewScreenshots(windowsScreenshotsPath: string) {
    try {
        // Single readdirSync — no stat calls. Compare filenames against known set.
        const currentFiles = fs.readdirSync(windowsScreenshotsPath);

        for (const filename of currentFiles) {
            if (/\.(png|jpe?g)$/i.test(filename) && !knownFiles.has(filename)) {
                knownFiles.add(filename);
                const fullPath = path.join(windowsScreenshotsPath, filename);
                await handleNewScreenshot(fullPath);
            }
        }
    } catch (error) {
        console.error(`Error during polling check: ${error}`);
    }
}

async function handleNewScreenshot(filePath: string): Promise<void> {
    try {
        // Verify file is ready (non-zero size)
        const stats = fs.statSync(filePath);
        if (!stats.isFile() || stats.size === 0) {
            return;
        }

        await copyScreenshotToWSL(filePath);
    } catch (error) {
        console.error(`Error processing screenshot ${filePath}:`, error);
    }
}

function cleanup() {
    console.log('Starting extension cleanup...');

    stopMonitoring();

    // Dispose all registered disposables
    for (const d of disposables) {
        try { d.dispose(); } catch {}
    }
    disposables = [];

    // Clean up old screenshots (keep today's)
    const dirToClean = screenshotDir;
    screenshotDir = undefined;

    const config = vscode.workspace.getConfiguration('wslScreenSnipper');
    const autoCleanup = config.get<boolean>('autoCleanup', true);

    if (autoCleanup && dirToClean && fs.existsSync(dirToClean)) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();

        try {
            let remaining = 0;
            for (const file of fs.readdirSync(dirToClean)) {
                const filePath = path.join(dirToClean, file);
                try {
                    const stats = fs.statSync(filePath);
                    if (stats.isFile() && stats.mtime.getTime() < todayMs) {
                        fs.unlinkSync(filePath);
                        console.log(`Removed old screenshot: ${file}`);
                    } else {
                        remaining++;
                    }
                } catch {}
            }
            // Remove directory only if empty
            if (remaining === 0) {
                fs.rmdirSync(dirToClean);
                console.log(`Removed empty screenshot directory: ${dirToClean}`);
            }
        } catch (error) {
            console.error('Failed to cleanup screenshots:', error);
        }
    }

    console.log('Extension cleanup completed');
}

export function deactivate() {
    console.log('Extension deactivating...');
    cleanup();
    console.log('Extension deactivated');
}