export type FileDiff = {
  path: string;
  added: boolean;
  deleted: boolean;
  binary: boolean;
  bytes: number;
  addedLines: { line: number; text: string }[];
  removedLines: string[];
};

const LITERAL = /^literal (\d+)$/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | undefined;
  let inHunk = false;
  let binaryPending = false;
  let next = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const b = line.lastIndexOf(' b/');
      file = {
        path: b >= 0 ? line.slice(b + 3) : line.slice(11),
        added: false,
        deleted: false,
        binary: false,
        bytes: 0,
        addedLines: [],
        removedLines: [],
      };
      files.push(file);
      inHunk = false;
      binaryPending = false;
      continue;
    }
    if (!file) continue;
    if (!inHunk) {
      if (line.startsWith('new file mode')) file.added = true;
      else if (line.startsWith('deleted file mode')) file.deleted = true;
      else if (line.startsWith('+++ b/')) file.path = line.slice(6);
      else if (line === 'GIT binary patch') {
        file.binary = true;
        binaryPending = true;
      } else if (binaryPending && LITERAL.test(line)) {
        file.bytes = Number(LITERAL.exec(line)![1]);
        binaryPending = false;
      }
    }
    const hunk = HUNK.exec(line);
    if (hunk) {
      inHunk = true;
      next = Number(hunk[1]);
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+')) {
      file.addedLines.push({ line: next++, text: line.slice(1) });
      file.bytes += Buffer.byteLength(line);
    } else if (line.startsWith('-')) {
      file.removedLines.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      next++;
    }
  }
  return files;
}
