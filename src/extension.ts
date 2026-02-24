import * as vscode from 'vscode';
import { minify, ALL_TRANSFORMS } from './pipeline';
import { PipelineOptions } from './types';

function countTokens(text: string): number {
  return text.split(/\s+/).filter(t => t.length > 0).length;
}

const outputChannel = vscode.window.createOutputChannel('Log Reducer');

export function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('Log Reducer extension activated');

  const disposable = vscode.commands.registerCommand(
    'logreducer.reduceClipboard',
    async () => {
      // Read from clipboard
      const clipboardText = await vscode.env.clipboard.readText();
      outputChannel.appendLine(`Clipboard: ${clipboardText.length} chars, ${clipboardText.split('\n').length} lines`);

      if (!clipboardText || clipboardText.trim() === '') {
        vscode.window.showWarningMessage('Log Reducer: Clipboard is empty.');
        return;
      }

      // Read settings — derive keys from ALL_TRANSFORMS so adding a
      // new transform automatically picks up its setting.
      const config = vscode.workspace.getConfiguration('logreducer');
      const options = Object.fromEntries(
        ALL_TRANSFORMS.map(t => [t.settingKey, config.get(t.settingKey, true)])
      ) as PipelineOptions;

      // Run the minification pipeline
      const result = minify(clipboardText, options);

      // Write result back to clipboard
      await vscode.env.clipboard.writeText(result);

      // Calculate token-based stats
      const inputTokens = countTokens(clipboardText);
      const outputTokens = countTokens(result);
      const reduction = Math.round((1 - outputTokens / inputTokens) * 100);

      // Open input and output side by side
      const inputDoc = await vscode.workspace.openTextDocument({
        content: clipboardText,
        language: 'log',
      });
      const outputDoc = await vscode.workspace.openTextDocument({
        content: result,
        language: 'log',
      });

      await vscode.window.showTextDocument(inputDoc, {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
      });
      await vscode.window.showTextDocument(outputDoc, {
        viewColumn: vscode.ViewColumn.Two,
        preview: false,
      });

      outputChannel.appendLine(`Result: ${inputTokens} → ${outputTokens} tokens (${reduction}% reduction)`);

      vscode.window.showInformationMessage(
        `Log Reducer: ${inputTokens} → ${outputTokens} tokens (${reduction}% reduction)`
      );
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
