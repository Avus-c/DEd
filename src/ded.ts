'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import Node from './node';
import * as format from './dedFormat';

export enum SortMode {
	Name,
	Ext,
	Size,
	Date,
}

const sortFunctions: Array<(a: Node, b: Node) => number> = [
	(a: Node, b: Node) => { return (a.name() > b.name()) ? 1 : -1; }, // descending via ascii code
	(a: Node, b: Node) => { return (a.fileExt() > b.fileExt()) ? 1 : -1; }, // descending via ascii code
	(a: Node, b: Node) => { return (a.size() < b.size()) ? 1 : -1; }, // descending (biggest first)
	(a: Node, b: Node) => { return (a.date() < b.date()) ? 1 : -1; }, // descending (newest first)
];

export enum Mode {
	Explore,
	Move,
	Copy
}

export default class DEd implements vscode.TextDocumentContentProvider {
	static scheme = 'DEd';

	private m_onChange = new vscode.EventEmitter<vscode.Uri>();
	private m_showHiddenNodes: boolean = false;
	private m_buffer: string[]; // container for displayed text
	private m_nodesDirs: Node[];
	private m_nodesFiles: Node[];
	private m_nodesLinks: Node[];
	private m_sortMode: SortMode = SortMode.Name;
	private m_path: string; // toplevel path of currently displayed directory
	private m_headerSize: number = 4; // does not include the first separator
	private m_mode: Mode = Mode.Explore;
	private m_moveOrCopy: Node[] = [];

	constructor() { }

	dispose() {
		this.m_onChange.dispose();
	}

	get onDidChange() {
		return this.m_onChange.event;
	}

	fireChangeSignal() {
		const uri = vscode.Uri.parse(`${DEd.scheme}://${this.m_path}`, true);
		this.m_onChange.fire(uri);
	}

	bufferPath(): string {
		return this.m_path;
	}

	toggleHiddenFiles() {
		this.m_showHiddenNodes = !this.m_showHiddenNodes;
		this.reRender();
	}

	async enter() {
		const node = this.nodeAtCursor();
		if (node === null) { return; }

		this.openNode(node.path(true), node.isDir(true));
	}

	reload() {
		this.readNodes(this.m_path);
		this.reRender();
	}

	async createDir() {
		const dirName = await vscode.window.showInputBox({ prompt: "Directory name" });
		if (!dirName) {
			return;
		}

		await fs.promises.mkdir(path.join(this.m_path, dirName), { recursive: true });
		this.m_nodesDirs.push(Node.create(this.m_path, dirName));
		this.reRender();
	}

	sort(sortMode: SortMode) {
		// TODO reverse order
		this.m_sortMode = sortMode;
		this.reRender();
	}

	async createOrOpen(pathToOpen: string) {
		if (fs.existsSync(pathToOpen)) {
			this.openNode(pathToOpen, fs.statSync(pathToOpen).isDirectory());
		} else {
			await fs.promises.mkdir(path.dirname(pathToOpen), { recursive: true });
			await fs.promises.writeFile(pathToOpen, "");
			this.m_nodesFiles.push(Node.create(path.dirname(pathToOpen), path.basename(pathToOpen)));
			this.reRender();
		}
	}

	mode(): Mode {
		return this.m_mode;
	}

	exitMode() {
		this.m_mode = Mode.Explore;
		this.m_moveOrCopy = [];
		this.reload();
	}

	async moveOrCopy(mode: Mode.Move | Mode.Copy) {
		this.m_mode = mode;

		if (!this.anythingSelected()) {
			this.select();
		}

		const isSelected = (x: string): boolean => { return x[0] === format.SELECTED_MARK; };
		const fromLine = (x: string): Node => { return Node.fromString(this.m_path, x); };

		this.m_moveOrCopy = this.m_buffer.filter(isSelected).map(fromLine);
		this.m_buffer[0] = `${this.modeLine()}`;
		this.fireChangeSignal();
	}

	async paste() {
		if (this.m_mode === Mode.Explore) {
			return;
		}

		const singleItemOp: boolean = this.m_moveOrCopy.length === 1;
		let new_path = this.m_path;
		if (singleItemOp) {
			const tmp = await vscode.window.showInputBox({ value: this.m_moveOrCopy[0].name(), title: `ded ${this.m_mode}`, prompt: "New file name" });
			if (tmp) { new_path = path.join(this.m_path, tmp); }
			// TODO figure out what the correct action should be if abort happens
			//? carry on with mode or clear everything
			else { return; }
		}

		this.moveOrCopyNodes(this.m_mode, new_path, this.m_moveOrCopy, singleItemOp);
		this.exitMode();
	}

	async delete() {
		if (!this.anythingSelected()) {
			this.select();
		}
		const quickPick = vscode.window.createQuickPick();
		quickPick.title = "Delete selection?";
		quickPick.items = [{ label: "Yes" }, { label: "No" }];
		quickPick.canSelectMany = false;

		const toDispose: vscode.Disposable[] = [];

		const handleQuickPick = () => new Promise<string>((resolve) => {
			toDispose.push(
				quickPick.onDidAccept(() => {
					quickPick.hide();
					resolve(quickPick.selectedItems[0].label);
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

		if (result === "Yes") {
			const selected = (x: string): boolean => { return x[0] === format.SELECTED_MARK; };
			const toLine = (x: string): Node => { return Node.fromString(this.m_path, x); };
			const toDelete: Node[] = this.m_buffer.filter(selected).map(toLine);

			toDelete.forEach((element: Node) => {
				const n = path.join(this.m_path, element.name());
				if (element.isDir()) {
					fs.rmSync(n, { recursive: true });
				} else {
					fs.unlinkSync(n);
				}
				vscode.window.showInformationMessage(`${n} deleted`);
			});

			this.reload();
		}
		else {
			vscode.window.showInformationMessage(`Deletion aborted`);
		}
	}

	select() {
		const editor = vscode.window.activeTextEditor;
		if (!editor) { return; }

		const doc = editor.document;
		if (!doc) { return; }

		let start = 0;
		let end = 0;

		if (editor.selection.isEmpty) {
			const line = editor.selection.active.line;
			start = line;
			if (start < this.m_headerSize) {
				// if selection is toggled in header, toggle on all nodes
				end = doc.lineCount;
			}
			else if (this.m_buffer[start][0] === '-') {
				end = this.m_buffer.length;
				// if selection is toggled on a separator, toggle all nodes in the section
				for (let i = start + 1; i < this.m_buffer.length; i++) {
					if (this.m_buffer[i][0] === '-') {
						end = i;
						break;
					}
				}
			} else {
				// if only 1 node was selected move cursor down
				end = line + 1;
				vscode.commands.executeCommand("cursorMove", { to: "down", by: "line" });
			}
		} else {
			start = editor.selection.start.line;
			end = editor.selection.end.line + 1;
		}

		start = Math.max(start, this.m_headerSize);
		end = Math.max(end, this.m_headerSize);

		for (let i = start; i < end; i++) {
			//* separators start with a dash and shall not be selectable
			if (this.m_buffer[i][0] === '-') {
				continue;
			}

			const selectChar = this.m_buffer[i][0] === format.SELECTED_MARK ? ' ' : format.SELECTED_MARK; // flip selected icon

			this.m_buffer[i] = selectChar + this.m_buffer[i].substring(1);
		}

		// !do not call this.reload here as it would recreate the dirView from scratch and remove any selections
		this.fireChangeSignal();
	}

	moveUp() {
		if (!this.m_path || this.m_path === "/" || this.m_path.substring(1) === ":\\") {
			return;
		}
		this.openNode(path.join(this.m_path, ".."), true);
	}

	async openNode(path: string, asView: boolean) {
		const getUri = (isDir: boolean, path: string): vscode.Uri => {
			if (isDir) {
				return vscode.Uri.parse(`${DEd.scheme}://${path}`, true);
			}
			return vscode.Uri.file(path);
		};

		if (asView) {
			this.readNodes(path);
			this.reRender();
		}

		const uri = getUri(asView, path);
		const doc = await vscode.workspace.openTextDocument(uri);
		vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Active, preview: asView });

		if (asView) {
			vscode.languages.setTextDocumentLanguage(doc, "ded");
		}
	}

	// called by vscode when a change signal is fired
	provideTextDocumentContent(): string {
		return this.m_buffer.join('\n');
	}

	private moveOrCopyNodes(mode: Mode.Move | Mode.Copy, newPath: string, nodes: Node[], singleOp: boolean = false) {
		// bind "recurse: true" to fs.cp to be able select between rename, copyFile and copy
		function copy(source: string, dest: string, callback: (err: NodeJS.ErrnoException | null) => void) {
			fs.cp(source, dest, { recursive: true }, callback);
		}

		const promises: Promise<void>[] = [];
		for (let i = 0; i < nodes.length; i++) {
			promises.push(
				new Promise<void>((resolve, reject) => {
					const node = nodes[i];

					const operation = mode === Mode.Move ? fs.rename : (node.isDir() ? copy : fs.copyFile);
					const new_path = singleOp ? newPath : path.join(newPath, node.name());
					operation(node.path(), new_path, (err) => {
						if (err) {
							vscode.window.showErrorMessage(`Failed to ${mode} ${node.name()}: ${err.message}`);
							return reject();
						}
						vscode.window.showInformationMessage(`${node.path()} ${mode === Mode.Move ? 'moved' : 'copied'} to ${newPath}`);
						return resolve();
					});
				})
			);
		}

		Promise.all(promises).then(() => {
			this.reload();
		});
	}

	private anythingSelected(): boolean {
		const selected = (x: string): boolean => { return x[0] === format.SELECTED_MARK; };
		return this.m_buffer.findIndex(selected) !== -1;
	}

	private readNodes(dir: string): void {
		const nodes_: Node[] = fs.readdirSync(dir).map((name: string): Node | null => {
			try {
				return Node.create(dir, name);
			} catch (error) {
				return null;
			}
		}).filter((node: Node | null) => { return node !== null; }) as Node[];

		this.m_path = dir;
		this.m_nodesDirs = nodes_.filter((node: Node): boolean => { return node.isDir(); });
		this.m_nodesFiles = nodes_.filter((node: Node): boolean => { return node.isFile(); });
		this.m_nodesLinks = nodes_.filter((node: Node): boolean => { return node.isSymLink(); });
	}

	private reRender(): void {
		this.sortNodes();

		const hide = (node: Node): boolean => {
			const hiddenNode = node.isHidden();
			return !hiddenNode || hiddenNode === this.m_showHiddenNodes;
		};

		const stringify = (node: Node): string => {
			for (let index = 0; index < this.m_moveOrCopy.length; index++) {
				if (this.m_moveOrCopy[index].path() === node.path()) {
					node.select(true);
					break;
				}
			}
			return node.toString();
		};

		this.m_buffer = this.generateHeader(this.m_path);

		let str = this.m_nodesDirs.filter(hide).map(stringify);
		if (str.length > 0) {
			this.m_buffer.push(this.generateSeparator());
			this.m_buffer = this.m_buffer.concat(str);
		}

		str = this.m_nodesFiles.filter(hide).map(stringify);
		if (str.length > 0) {
			this.m_buffer.push(this.generateSeparator());
			this.m_buffer = this.m_buffer.concat(str);
		}

		str = this.m_nodesLinks.filter(hide).map(stringify);
		if (str.length > 0) {
			this.m_buffer.push(this.generateSeparator());
			this.m_buffer = this.m_buffer.concat(str);
		}

		if (this.m_buffer.length === this.m_headerSize) {
			this.m_buffer.push(this.generateSeparator());
		}

		this.fireChangeSignal();
	}

	private generateSeparator(): string {
		return [
			'-'.repeat(format.SELECTED_LENGTH),
			'-'.repeat(format.NAME_HEADER.length).padEnd(format.NAME_LENGTH),
			'-'.repeat(format.SIZE_HEADER.length).padStart(format.SIZE_LENGTH),
			'-'.repeat(format.DATE_HEADER.length).padStart(format.DATE_LENGTH),
			'-'.repeat(format.ATTR_HEADER.length), // padding here will just lead to trailing withspaces
		].join(' '.repeat(format.COLUMN_MARGIN));
	}

	private generateHeader(dirname: string): string[] {
		const header: string = [
			format.SELECTED_HEADER,
			format.NAME_HEADER.padEnd(format.NAME_LENGTH),
			format.SIZE_HEADER.padStart(format.SIZE_LENGTH),
			format.DATE_HEADER.padStart(format.DATE_LENGTH),
			format.ATTR_HEADER, // padding here will just lead to trailing withspaces
		].join(' '.repeat(format.COLUMN_MARGIN));

		return [
			`${this.modeLine()}`,
			`${dirname}:`,
			"",
			`${header}`
		];
	}

	private modeLine(): string {
		const map = new Map<Mode, string>([
			[Mode.Explore, "Explore"],
			[Mode.Move, "Move"],
			[Mode.Copy, "Copy"]
		]);
		let head: string = `${map.get(this.m_mode)} - mode`;
		if (this.m_mode !== Mode.Explore) {
			head = head.concat(`: ${this.m_moveOrCopy.length} nodes selected. Paste with with <p>. Abort with <q>`);
		}
		return head;
	}

	private nodeAtCursor(): Node | null {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.selection.active.line < this.m_headerSize) {
			return null;
		}
		const lineText = editor.document.lineAt(editor.selection.active.line).text;

		// Skip lines starting with '-'
		if (lineText && lineText[0] !== '-') {
			return Node.fromString(this.m_path, lineText);
		}
		return null;
	}

	private sortNodes() {
		this.m_nodesDirs.sort(sortFunctions[this.m_sortMode]);
		this.m_nodesFiles.sort(sortFunctions[this.m_sortMode]);
		this.m_nodesLinks.sort(sortFunctions[this.m_sortMode]);
	}

	private getHelpMenu() {
		// TODO: Display Keyboard shortcuts (maybe at the bottom?)
	}
}
