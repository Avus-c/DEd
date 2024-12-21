'use strict';

import * as vscode from 'vscode';
import DEd, { Mode, SortMode } from './ded';

import { homedir } from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { autocompletedInputBox } from './autocompletedInputBox';

export interface ExtensionInternal {
	DEd: DEd,
}

function completionFunc(input: string): vscode.QuickPickItem[] {
	const items: vscode.QuickPickItem[] = [];
	let searchDir: string = path.dirname(input);

	if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
		searchDir = input;

		items.push({
			label: searchDir,
			description: `Open Directory`,
		});
	}

	return items.concat(
		fs.readdirSync(searchDir)
			.map((node) => (path.join(searchDir, node)))
			.filter((p) => {
				try {
					return fs.statSync(p).isDirectory();
				} catch { return false; }
			})
			.map((p): vscode.QuickPickItem => ({ label: p })));
}

export function activate(context: vscode.ExtensionContext): ExtensionInternal {
	const ded = new DEd();

	const providerRegistrations = vscode.Disposable.from(
		vscode.workspace.registerTextDocumentContentProvider(DEd.scheme, ded),
	);
	const commandOpen = vscode.commands.registerCommand("extension.ded.open", async () => {
		const workspace = vscode.workspace.workspaceFolders;
		let defaultOptions: vscode.QuickPickItem[] = [];

		if (workspace) {
			defaultOptions.push({ kind: vscode.QuickPickItemKind.Separator, label: "Workspace folders" });
			defaultOptions = defaultOptions.concat(
				workspace.map((w): vscode.QuickPickItem => ({
					label: w.uri.fsPath
				})));
		}
		defaultOptions.push({
			label: "Home directory",
			kind: vscode.QuickPickItemKind.Separator
		});
		defaultOptions.push({
			label: homedir(),
		});

		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.uri.scheme !== DEd.scheme) {
			const doc = editor.document;
			defaultOptions.push({
				label: "Directory of active file",
				kind: vscode.QuickPickItemKind.Separator
			});
			defaultOptions.push({
				label: path.dirname(doc.fileName),
			});
		}

		const quickPick = vscode.window.createQuickPick();
		quickPick.title = "ded: Open directory";
		quickPick.items = defaultOptions;
		quickPick.canSelectMany = false;
		quickPick.placeholder = "Choose which dir to open, or provide an absolute path:";

		const toDispose: vscode.Disposable[] = [];

		const handleQuickPick = () => new Promise<string>((resolve) => {
			toDispose.push(
				quickPick.onDidChangeValue(() => {
					if (quickPick.value === "") {
						quickPick.items = defaultOptions;
					} else {
						quickPick.items = completionFunc(quickPick.value);
					}
				}),
				quickPick.onDidAccept(() => {
					if (quickPick.value === "") {
						quickPick.hide();
						resolve(quickPick.selectedItems[0].label);
					}
					else if (quickPick.selectedItems.length === 0 || quickPick.selectedItems[0].label === quickPick.value) {
						quickPick.hide();
						resolve(quickPick.selectedItems[0].label);
					} else {
						quickPick.value = quickPick.selectedItems[0].label;
					}
				}),
				quickPick.onDidHide(() => {
					quickPick.dispose();
					resolve("");
				})
			);
			quickPick.show();
		});
		const result = await handleQuickPick();
		toDispose.forEach((x) => x.dispose());

		if (result === "") {
			return;
		}

		try {
			ded.openNode(result, fs.statSync(result).isDirectory());
		} catch (error) {
			vscode.window.showInformationMessage(error);
		}
	});
	const commandEnter = vscode.commands.registerCommand("extension.ded.enter", () => {
		ded.enter();
	});
	const commandShowHiddenFiles = vscode.commands.registerCommand("extension.ded.showHiddenFiles", () => {
		ded.toggleHiddenFiles();
	});
	const commandCreateDir = vscode.commands.registerCommand("extension.ded.createDir", () => {
		ded.createDir();
	});
	const commandMove = vscode.commands.registerCommand("extension.ded.move", () => {
		ded.moveOrCopy(Mode.Move);
	});
	const commandCopy = vscode.commands.registerCommand("extension.ded.copy", () => {
		ded.moveOrCopy(Mode.Copy);
	});
	const commandPaste = vscode.commands.registerCommand("extension.ded.paste", () => {
		ded.paste();
	});
	const commandDelete = vscode.commands.registerCommand("extension.ded.delete", () => {
		ded.delete();
	});
	// TODO rename to move up
	const commandGoUpDir = vscode.commands.registerCommand("extension.ded.goUpDir", () => {
		ded.moveUp();
	});
	const commandRefresh = vscode.commands.registerCommand("extension.ded.refresh", () => {
		ded.reload();
	});
	const commandHome = vscode.commands.registerCommand("extension.ded.home", () => {
		ded.openNode(homedir(), true);
	});
	const commandToggleSelect = vscode.commands.registerCommand("extension.ded.toggleSelect", () => {
		ded.select();
	});
	const commandSortName = vscode.commands.registerCommand("extension.ded.sort.name", () => {
		ded.sort(SortMode.Name);
	});
	const commandSortSize = vscode.commands.registerCommand("extension.ded.sort.size", () => {
		ded.sort(SortMode.Size);
	});
	const commandSortDate = vscode.commands.registerCommand("extension.ded.sort.date", () => {
		ded.sort(SortMode.Date);
	});
	const commandSortFileExt = vscode.commands.registerCommand("extension.ded.sort.fileExtension", () => {
		ded.sort(SortMode.Ext);
	});
	const commandClose = vscode.commands.registerCommand("extension.ded.close", () => {
		if (ded.mode() !== Mode.Explore) {
			ded.exitMode();
		}
		else {
			vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		}
	});
	// TODO rename to open item
	const commandCreateFile = vscode.commands.registerCommand("extension.ded.createFile", async () => {
		const pathName = await autocompletedInputBox("Create File or Open", ded.bufferPath());
		if (pathName === "") {
			return;
		}
		await ded.createOrOpen(pathName);
	});

	context.subscriptions.push(
		ded,
		commandOpen,
		commandEnter,
		commandShowHiddenFiles,
		commandCreateDir,
		commandCreateFile,
		commandMove,
		commandCopy,
		commandPaste,
		commandGoUpDir,
		commandRefresh,
		commandClose,
		commandDelete,
		commandToggleSelect,
		commandHome,
		commandSortName,
		commandSortSize,
		commandSortDate,
		commandSortFileExt,
		providerRegistrations
	);

	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor && editor.document.uri.scheme === DEd.scheme) {
			editor.options = {
				cursorStyle: vscode.TextEditorCursorStyle.Block,
			};
			vscode.commands.executeCommand('setContext', 'ded.open', true);
			const newPosition = new vscode.Position(ded.cursorPos(), 0);
			const newSelection = new vscode.Selection(newPosition, newPosition);
			editor.selection = newSelection;
		} else {
			vscode.commands.executeCommand('setContext', 'ded.open', false);
		}
	});

	return {
		DEd: ded,
	};
}
