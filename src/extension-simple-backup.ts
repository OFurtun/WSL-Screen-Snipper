import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('=== WSL Screen Snipper SIMPLE VERSION activated ===');
    
    // Show visible notification
    vscode.window.showInformationMessage('WSL Screen Snipper activated! Testing basic functionality...');
    
    // Test basic functionality immediately
    setTimeout(() => {
        testBasicFunctionality();
    }, 1000);
    
    // Register command for manual screenshot saving
    const saveImageCommand = vscode.commands.registerCommand('wslScreenSnipper.saveImage', async () => {
        vscode.window.showInformationMessage('Manual command triggered!');
        await manualSaveImage();
    });
    
    context.subscriptions.push(saveImageCommand);
}

async function testBasicFunctionality() {
    console.log('=== Testing Basic Functionality ===');
    
    // Test Windows Screenshots path
    const windowsScreenshotsPath = '/mnt/c/Users/omerc/Pictures/Screenshots';
    console.log(`Testing path: ${windowsScreenshotsPath}`);
    
    if (!fs.existsSync(windowsScreenshotsPath)) {
        console.error('❌ CRITICAL: Windows Screenshots directory not found!');
        vscode.window.showErrorMessage(`Screenshots directory not found: ${windowsScreenshotsPath}`);
        return;
    }
    
    console.log('✓ Windows Screenshots directory exists');
    vscode.window.showInformationMessage('✓ Found Windows Screenshots directory');
    
    // Get recent screenshots
    try {
        const files = fs.readdirSync(windowsScreenshotsPath)
            .filter(f => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'))
            .map(f => {
                const fullPath = path.join(windowsScreenshotsPath, f);
                const stats = fs.statSync(fullPath);
                return {
                    name: f,
                    path: fullPath,
                    mtime: stats.mtime.getTime()
                };
            })
            .sort((a, b) => b.mtime - a.mtime);
        
        console.log(`Found ${files.length} screenshots`);
        vscode.window.showInformationMessage(`Found ${files.length} screenshots in Windows folder`);
        
        if (files.length > 0) {
            const mostRecent = files[0];
            console.log(`Most recent: ${mostRecent.name}`);
            vscode.window.showInformationMessage(`Most recent: ${mostRecent.name}`);
            
            // Test copying
            await testCopy(mostRecent.path);
        }
        
    } catch (error) {
        console.error('❌ Error reading screenshots:', error);
        vscode.window.showErrorMessage(`Error reading screenshots: ${error}`);
    }
}

async function testCopy(sourceFile: string) {
    console.log(`=== Testing Copy of ${path.basename(sourceFile)} ===`);
    
    try {
        // Get workspace or use temp directory
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        let targetDir: string;
        
        if (workspaceFolder) {
            targetDir = path.join(workspaceFolder.uri.fsPath, '.vscode', 'SessionScreenshots');
            console.log(`Using workspace directory: ${targetDir}`);
        } else {
            targetDir = path.join(process.env.HOME || '/tmp', '.wsl-screen-snipper');
            console.log(`Using temp directory: ${targetDir}`);
        }
        
        // Create directory if needed
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
            console.log(`✓ Created directory: ${targetDir}`);
        }
        
        // Copy file
        const fileName = path.basename(sourceFile);
        const targetPath = path.join(targetDir, fileName);
        
        fs.copyFileSync(sourceFile, targetPath);
        console.log(`✓ Successfully copied to: ${targetPath}`);
        
        // Verify copy
        const targetStats = fs.statSync(targetPath);
        console.log(`✓ Copied file size: ${targetStats.size} bytes`);
        
        vscode.window.showInformationMessage(`✓ Screenshot copied successfully: ${fileName}`);
        
        return targetPath;
        
    } catch (error) {
        console.error(`❌ Copy failed: ${error}`);
        vscode.window.showErrorMessage(`Copy failed: ${error}`);
    }
}

async function manualSaveImage() {
    console.log('=== Manual Save Image Command ===');
    await testBasicFunctionality();
}

export function deactivate() {
    console.log('WSL Screen Snipper deactivated');
}