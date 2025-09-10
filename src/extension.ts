import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

let screenshotDir: string | undefined;
let disposables: vscode.Disposable[] = [];
let fileWatcher: fs.FSWatcher | undefined;
let lastSavedImagePath: string | undefined;
let processedFiles: Set<string> = new Set();
let pollingInterval: NodeJS.Timeout | undefined;
let lastScreenshotCheck: number = 0;

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

    // Setup screenshot directory and start monitoring
    let setupSuccess = false;
    let monitoringSuccess = false;
    
    setupScreenshotDirectory().then(() => {
        console.log('Screenshot directory setup completed');
        setupSuccess = true;
        checkAndShowStatus();
    }).catch((error) => {
        console.error('Failed to setup screenshot directory:', error);
        vscode.window.showErrorMessage(`WSL Screen Snipper: Failed to setup screenshot directory - ${error}`);
    });

    // Start file monitoring for Windows screenshots
    try {
        const result = startFileMonitoring();
        if (result) {
            console.log('File monitoring started successfully');
            monitoringSuccess = true;
            checkAndShowStatus();
        } else {
            console.log('File monitoring setup failed');
            vscode.window.showWarningMessage('WSL Screen Snipper: File monitoring could not start - check Screenshots directory');
        }
    } catch (error) {
        console.error('Failed to start file monitoring:', error);
        vscode.window.showErrorMessage(`WSL Screen Snipper: Failed to start file monitoring - ${error}`);
    }
    
    function checkAndShowStatus() {
        if (setupSuccess && monitoringSuccess) {
            vscode.window.showInformationMessage('WSL Screen Snipper: Ready! Screenshot monitoring active');
        }
    }

    // Register terminal paste interceptor
    registerPasteInterceptor(context);

    // Setup cleanup on deactivation
    context.subscriptions.push({
        dispose: () => {
            cleanup();
        }
    });
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
        
        // Copy WSL path to clipboard for easy pasting
        copyToClipboard(targetPath);
        
        vscode.window.showInformationMessage(`Screenshot copied: ${fileName}`);
        return targetPath;
    } catch (error) {
        vscode.window.showErrorMessage(`Error copying screenshot: ${error}`);
        return undefined;
    }
}

function copyToClipboard(text: string): void {
    try {
        // Use clip.exe directly for maximum speed (fire-and-forget)
        const clipProcess = spawn('clip.exe');
        clipProcess.stdin.write(text);
        clipProcess.stdin.end();
        console.log(`Copied to clipboard: ${text}`);
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        // Don't fallback to VS Code API as it's slower - just log the error
    }
}

function startFileMonitoring(): boolean {
    const windowsScreenshotsPath = getWindowsScreenshotsPath();
    
    // Check if path was configured
    if (!windowsScreenshotsPath) {
        console.error('Windows Screenshots path not configured');
        return false;
    }
    
    // Check if directory exists
    if (!fs.existsSync(windowsScreenshotsPath)) {
        console.error(`Windows Screenshots directory not found: ${windowsScreenshotsPath}`);
        vscode.window.showErrorMessage(`Screenshots directory not found: ${windowsScreenshotsPath}. Please check your Windows username setting.`);
        return false;
    }

    // Initialize last check time
    lastScreenshotCheck = Date.now();

    try {
        // Primary: Try fs.watch (may not work reliably with WSL)
        fileWatcher = fs.watch(windowsScreenshotsPath, async (eventType, filename) => {
            if (eventType === 'rename' && filename && (filename.endsWith('.png') || filename.endsWith('.jpg') || filename.endsWith('.jpeg'))) {
                const fullPath = path.join(windowsScreenshotsPath, filename);
                
                // Small delay to ensure file is fully written
                setTimeout(async () => {
                    await handleNewScreenshot(fullPath);
                }, 1000);
            }
        });
        
        console.log(`Primary monitoring (fs.watch) started for: ${windowsScreenshotsPath}`);
    } catch (error) {
        console.warn(`fs.watch failed: ${error}`);
    }

    // Fallback: Polling-based monitoring for better WSL compatibility
    const config = vscode.workspace.getConfiguration('wslScreenSnipper');
    const pollingMs = config.get<number>('pollingInterval', 500);
    
    pollingInterval = setInterval(async () => {
        await checkForNewScreenshots(windowsScreenshotsPath);
    }, pollingMs);

    console.log(`Polling-based monitoring started for: ${windowsScreenshotsPath}`);
    
    return true;
}

async function checkForNewScreenshots(windowsScreenshotsPath: string) {
    try {
        // Efficient approach: find only the newest file instead of reading all files
        let newestFile = null;
        let newestTime = lastScreenshotCheck;
        
        const files = fs.readdirSync(windowsScreenshotsPath);
        
        // Iterate through files and track only the newest screenshot
        for (const filename of files) {
            if (filename.endsWith('.png') || filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
                const fullPath = path.join(windowsScreenshotsPath, filename);
                try {
                    const stats = fs.statSync(fullPath);
                    const mtime = stats.mtime.getTime();
                    
                    if (mtime > newestTime) {
                        newestTime = mtime;
                        newestFile = {
                            name: filename,
                            path: fullPath,
                            mtime: mtime
                        };
                    }
                } catch (statError) {
                    // Skip files we can't stat (might be in use)
                    continue;
                }
            }
        }

        if (newestFile) {
            console.log(`Found new screenshot: ${newestFile.name}`);
            
            // Update last check time to newest file
            lastScreenshotCheck = newestFile.mtime;
            
            // Process the newest screenshot
            await handleNewScreenshot(newestFile.path);
        }
    } catch (error) {
        console.error(`Error during polling check: ${error}`);
    }
}

async function handleNewScreenshot(filePath: string): Promise<void> {
    // Skip if already processed
    if (processedFiles.has(filePath)) {
        return;
    }
    
    // Check if file exists and is readable
    try {
        if (!fs.existsSync(filePath)) {
            return;
        }
        
        const stats = fs.statSync(filePath);
        if (!stats.isFile() || stats.size === 0) {
            return;
        }
        
        // Mark as processed
        processedFiles.add(filePath);
        
        // Copy to WSL and update clipboard
        const wslPath = await copyScreenshotToWSL(filePath);
        if (wslPath) {
            lastSavedImagePath = wslPath;
        }
        
    } catch (error) {
        console.error(`Error processing screenshot ${filePath}:`, error);
    }
}

function registerPasteInterceptor(context: vscode.ExtensionContext) {
    // Register keybinding for Ctrl+V in terminal
    const pasteCommand = vscode.commands.registerCommand('wslScreenSnipper.interceptPaste', async () => {
        console.log(`Paste interceptor triggered. lastSavedImagePath: ${lastSavedImagePath}, activeTerminal: ${!!vscode.window.activeTerminal}`);
        
        if (lastSavedImagePath && vscode.window.activeTerminal) {
            console.log(`Sending WSL path to terminal: ${lastSavedImagePath}`);
            // Send the WSL path to terminal instead of clipboard content
            vscode.window.activeTerminal.sendText(lastSavedImagePath, false);
            vscode.window.showInformationMessage(`Pasted screenshot path: ${path.basename(lastSavedImagePath)}`);
        } else {
            console.log('Falling back to normal paste');
            // Fallback to normal paste
            await vscode.commands.executeCommand('workbench.action.terminal.paste');
        }
    });

    context.subscriptions.push(pasteCommand);
}


function cleanup() {
    // Stop file monitoring
    if (fileWatcher) {
        fileWatcher.close();
        fileWatcher = undefined;
    }

    // Stop polling
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = undefined;
    }

    // Clear processed files set
    processedFiles.clear();

    const config = vscode.workspace.getConfiguration('wslScreenSnipper');
    const autoCleanup = config.get<boolean>('autoCleanup', true);
    
    if (autoCleanup && screenshotDir && fs.existsSync(screenshotDir)) {
        try {
            // Remove the entire directory and all its contents
            fs.rmSync(screenshotDir, { recursive: true, force: true });
            console.log(`Cleaned up and removed screenshot directory: ${screenshotDir}`);
        } catch (error) {
            console.error('Failed to cleanup screenshot directory:', error);
        }
    }
}

export function deactivate() {
    cleanup();
    disposables.forEach(d => d.dispose());
}