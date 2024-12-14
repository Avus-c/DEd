export const COLUMN_MARGIN: number = 2;

export const SELECTED_MARK: string = "*";

export const SELECTED_HEADER: string = "#";
export const SELECTED_LENGTH: number = 1;
export const SELECTED_START_INDEX: number = 0;

export const NAME_HEADER: string = "Name";
export const NAME_LENGTH: number = 40;
export const NAME_START_INDEX: number = SELECTED_START_INDEX + SELECTED_LENGTH + COLUMN_MARGIN;

export const SIZE_HEADER: string = "Size";
export const SIZE_LENGTH: number = 9;
export const SIZE_START_INDEX: number = NAME_START_INDEX + NAME_LENGTH + COLUMN_MARGIN;

export const DATE_HEADER: string = "LastWriteTime";
export const DATE_LENGTH: number = 16;
export const DATE_START_INDEX: number = SIZE_START_INDEX + SIZE_LENGTH + COLUMN_MARGIN;

export const ATTR_HEADER: string = "Attr";
export const ATTR_LENGTH: number = 5;
export const ATTR_START_INDEX: number = DATE_START_INDEX + DATE_LENGTH + COLUMN_MARGIN;

export const DETAILS_START_INDEX: number = ATTR_START_INDEX + ATTR_LENGTH + COLUMN_MARGIN;
