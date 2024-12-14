'use strict';

import * as fs from 'fs';
import * as Path from 'path';
import * as Format from './dedFormat';

const fileExtension = (name: string): string => {
	// remove '.' from hidden files to make parsing of extension easier
	name = name.startsWith('.') ? name.substring(1) : name;
	const tmp = name.split('.');
	return tmp.length === 1 ? "" : tmp[tmp.length - 1];
};

export default class Node {
	constructor(
		private m_dir: string, // absolute path to this entry
		private m_name: string,
		private m_isDir: boolean = true,	// also true if node is symlink but points to Dir. To check if it node is actually Dir, use getter function
		private m_isFile: boolean = false,	// also true if node is symlink but points to File. To check if it node is actually File, use getter function
		private m_isSymlink: boolean = false,
		private m_isReadOnly: boolean = false,
		private m_isHidden: boolean = false,
		private m_size: number = 0, // if(m_isDir){m_size = amount of elements}
		private m_date: Date,
		private m_symlinkTarget: string = "",
		private m_selected: boolean = false,
		private m_ext: string = "", // only valid on files
	) { }

	public static create(dir: string, name: string): Node {
		const path = Path.join(dir, name);
		let fileMetaData: fs.Stats = fs.lstatSync(path);

		const isSymLink = fileMetaData.isSymbolicLink();
		const readOnly: boolean = (fileMetaData.mode & fs.constants.S_IWUSR) === 0;
		const date = fileMetaData.ctime;

		// override metaData with actual object to get info at what the link points to
		if (isSymLink) {
			try { fileMetaData = fs.statSync(path); }
			catch {
				// if it fails, just carry on with the info of the symlink directly
				// can fail if symlink points to something we don't habe permission to access
			}
		}

		const isDir: boolean = fileMetaData.isDirectory();
		const isFile: boolean = fileMetaData.isFile();

		// HACK: This only works for POSIX systems. Windows handles hidden files differently, for which
		// nodejs does not provide build-in support for.
		const hidden: boolean = name.startsWith('.');

		const fileExt = isFile ? fileExtension(name) : "";

		const size: number = (() => {
			if (isDir) {
				try {
					return fs.readdirSync(path).length;
				} catch (error) {
					return -1;
				}
			} else {
				return fileMetaData.size;
			}
		})();

		return new Node(
			dir,
			name,
			isDir,
			isFile,
			isSymLink,
			readOnly,
			hidden,
			size,
			date,
			isSymLink ? fs.readlinkSync(path) : "", // what path symlinks target to
			false,
			fileExt
		);
	}

	public path(followSymLink: boolean = false): string {
		if (!followSymLink || !this.m_isSymlink) { return Path.join(this.m_dir, this.m_name); }
		if (Path.isAbsolute(this.m_symlinkTarget)) { return Path.normalize(this.m_symlinkTarget); }
		else { return Path.join(this.m_dir, this.m_symlinkTarget); }
	}

	public isFile(followSymLink: boolean = false): boolean {
		return this.m_isFile && (followSymLink || !this.m_isSymlink);
	}

	public isDir(followSymLink: boolean = false): boolean {
		return this.m_isDir && (followSymLink || !this.m_isSymlink);
	}

	public isSymLink(): boolean {
		return this.m_isSymlink;
	}

	public isHidden(): boolean {
		return this.m_isHidden;
	}

	public name(): string {
		return this.m_name;
	}

	public size(): number {
		return this.m_size;
	}

	public date(): Date {
		return this.m_date;
	}

	public fileExt(): string {
		return this.m_ext;
	}

	public select(b: boolean): void {
		this.m_selected = b;
	}

	public toString(): string {
		const size: string = (() => {
			if (this.m_size === -1) { return '---'; }
			if (this.m_isDir) { return `${this.m_size} E`; }
			return formatFileSize(this.m_size);
		})().padStart(Format.SIZE_LENGTH);

		const attr = formatAttr(this.m_isDir,
			this.m_isFile,
			this.m_isSymlink,
			this.m_isReadOnly,
			this.m_name.startsWith('.')
		);

		const date: string = formatDate(this.m_date);

		let displayedName: string = this.m_name;
		let details: string = "";

		if (this.m_name.length > 40) {
			displayedName = this.m_name.substring(0, 36).concat("...");
			details = this.m_name;
		}

		if (this.m_isDir) {
			displayedName = displayedName.concat('/');
		}

		if (this.m_isSymlink) {
			details = details.concat('-> ' + this.m_symlinkTarget);
		}

		return [
			this.m_selected ? "*" : " ",
			displayedName.padEnd(Format.NAME_LENGTH),
			size,
			date,
			attr,
			details // may be empty, and cause trailing whitespaces
		].join(' '.repeat(Format.COLUMN_MARGIN)).trimEnd();
	}

	public static fromString(dir: string, line: string): Node {
		line = line.trimEnd();
		const selected: boolean = line[0] === "*";
		const name: string = line.substring(Format.NAME_START_INDEX, Format.NAME_START_INDEX + Format.NAME_LENGTH).trimEnd();
		const size: string = line.substring(Format.SIZE_START_INDEX, Format.SIZE_START_INDEX + Format.SIZE_LENGTH).trimStart();
		const date: string = line.substring(Format.DATE_START_INDEX, Format.DATE_START_INDEX + Format.DATE_LENGTH).trim();
		const attr: string = line.substring(Format.ATTR_START_INDEX, Format.ATTR_START_INDEX + Format.ATTR_LENGTH);
		const details: string = line.substring(Format.DETAILS_START_INDEX).trim();

		const isLink: boolean = attr[0] === 'l';
		const isFile: boolean = attr[1] === 'a';
		const isDir: boolean = attr[0] === 'd' || (isLink && !isFile);
		const isRO: boolean = attr[2] === 'r';
		const isHidden: boolean = attr[3] === 'h';

		const itemName: string = (name.endsWith(".../") || name.endsWith("...")) ? details.split('->')[0] : name;
		const symlinkTarget: string = isLink ? details.split('->')[1].trim() : "";

		const fileExt: string = isFile ? fileExtension(name) : "";

		return new Node(
			dir,
			itemName,
			isDir,
			isFile,
			isLink,
			isRO,
			isHidden,
			parseSize(size),
			parseDate(date),
			symlinkTarget,
			selected,
			fileExt
		);
	}
}

function formatAttr(isDir: boolean, isFile: boolean, isSymLink: boolean, isReadonly: boolean, isHidden: boolean): string {
	const first = (isSymLink ? 'l' : (isDir ? 'd' : '-'));
	const second = isFile ? 'a' : '-';
	const third = isReadonly ? 'r' : '-';
	const forth = isHidden ? 'h' : '-';
	return `${first}${second}${third}${forth}-`;
}

function formatDate(date: Date): string {
	const str_year: string = date.getFullYear().toString();
	const str_month: string = (date.getMonth() + 1).toString().padStart(2, "0");
	const str_day: string = date.getDate().toString().padStart(2, "0");
	const str_hour: string = date.getHours().toString().padStart(2, "0");
	const str_min: string = date.getMinutes().toString().padStart(2, "0");

	return `${str_day}.${str_month}.${str_year} ${str_hour}:${str_min}`;
}

function parseDate(dateString: string): Date {
	const [datePart, timePart] = dateString.split(' ');
	const [day, month, year] = datePart.split('.').map(Number);
	const [hour, minute] = timePart.split(':').map(Number);

	return new Date(year, month - 1, day, hour, minute);
}

function formatFileSize(sizeInBytes: number): string {
	const KB = 1024;
	const MB = KB * 1024;
	const GB = MB * 1024;

	if (sizeInBytes < KB) {
		return `${sizeInBytes} B`;
	} else if (sizeInBytes < MB) {
		return `${(sizeInBytes / KB).toFixed(0)} K`;
	} else if (sizeInBytes < GB) {
		return `${(sizeInBytes / MB).toFixed(2)} M`;
	} else {
		return `${(sizeInBytes / GB).toFixed(2)} G`;
	}
}

function parseSize(sizeString: string): number {
	if (sizeString === '---') {
		return -1;
	}

	const numericPart = parseFloat(sizeString);
	const unit = sizeString.charAt(sizeString.length - 1).toUpperCase();

	const KB = 1024;
	const MB = KB * 1024;
	const GB = MB * 1024;

	switch (unit) {
		case 'B':
			return numericPart;
		case 'K':
			return numericPart * KB;
		case 'M':
			return numericPart * MB;
		case 'G':
			return numericPart * GB;
		case 'E': // for directories
			return numericPart;
	}
	return numericPart;
}
