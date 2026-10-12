export const RECIPES = [
  {
    id: 'find-text', title: 'Find text across a project', category: 'Search', screen: 'search',
    description: 'Search file contents without memorizing grep flags.',
    explanation: 'Enter a word or phrase in Search. Results show the file and matching line so you can open the surrounding context. Start with plain text; use the regular-expression option when you need a pattern.',
    examples: [{ command: 'grep -RIn -- "search text" .', explanation: 'Recursively searches the current directory and prints matching line numbers.' }],
  },
  {
    id: 'find-todos', title: 'Find unfinished work', category: 'Search', screen: 'search', query: 'TODO',
    description: 'Locate TODO comments and notes across your files.',
    explanation: 'Search for TODO to collect reminders left in code and notes. To look for several markers together, turn on regular expressions and search for TODO|FIXME|HACK.',
    examples: [{ command: 'grep -RInE -- "TODO|FIXME|HACK" .', explanation: 'The E option allows alternatives separated by |; each matching line is printed.' }],
  },
  {
    id: 'find-config', title: 'Locate a configuration file', category: 'Files', screen: 'files',
    description: 'Browse the project and open the file you need.',
    explanation: 'Use Files to explore folders without changing your terminal directory. Configuration is often in names such as package.json, tsconfig.json, or a dotfile. Inspect file contents before editing a setting.',
    examples: [{ command: 'find . -type f -name "*.json"', explanation: 'Finds regular files whose names end in .json. Quotes keep your shell from expanding the pattern early.' }],
  },
  {
    id: 'large-files', title: 'Find what is taking up space', category: 'Files', screen: 'disk',
    description: 'Inspect project disk usage and large files.',
    explanation: 'Open Disk to see where project storage goes. Generated output, dependency folders, and large data files can add up quickly. Inspect a file before deciding whether to remove it; this view does not delete anything.',
    examples: [
      { command: 'du -sh .', explanation: 'Shows the total disk space used by the current folder in readable units.' },
      { command: 'find . -type f -size +100M', explanation: 'Finds files larger than 100 MiB on common Linux and macOS find implementations.' },
    ],
  },
  {
    id: 'review-changes', title: 'Understand what changed', category: 'Git', screen: 'git',
    description: 'See edited, added, and deleted files before committing.',
    explanation: 'Git lists changes relative to your last commit. Review the file list and diff before staging. A commit records a local snapshot; pushing uploads commits to the configured remote repository.',
    examples: [
      { command: 'git status --short', explanation: 'Summarizes file changes; the left column is staged and the right column is unstaged.' },
      { command: 'git diff', explanation: 'Shows edits to tracked files that have not yet been staged.' },
    ],
  },
  {
    id: 'upload-work', title: 'Save and upload your work', category: 'Git', screen: 'git',
    description: 'Follow the stage, commit, and push workflow.',
    explanation: 'In Git, review your changes, stage the intended files, write a commit message, then push. A successful commit alone does not upload anything. Check the remote and branch before using Push; authentication comes from your existing Git setup.',
    examples: [
      { command: 'git diff --cached', explanation: 'Shows exactly the staged changes that would go into your next commit.' },
      { command: 'git log -1 --oneline', explanation: 'Shows the most recent local commit and its message.' },
    ],
  },
  {
    id: 'check-sync', title: 'Check whether Git is synchronized', category: 'Git', screen: 'git',
    description: 'Read branch, remote, and ahead or behind status.',
    explanation: 'Ahead means local commits are waiting to be pushed; behind means your last fetched remote reference has commits you do not have. Fetch updates that reference without changing working files. A clean working folder and an uploaded branch are separate checks.',
    examples: [{ command: 'git status --short --branch', explanation: 'Shows working changes and the branch relationship to the last known upstream reference.' }],
  },
  {
    id: 'processes', title: 'See what is running', category: 'System', screen: 'processes',
    description: 'Inspect process names, memory, and CPU information.',
    explanation: 'The Processes view shows running programs and memory use without requiring ps flags. CPU is reported as a percentage on Linux and macOS, and as cumulative CPU seconds on Windows. Select a process and press K to review a stop request. Only your own eligible processes can be stopped; unsaved work can be lost. Windows terminates immediately, while Linux and macOS send SIGTERM without automatic escalation.',
    examples: [{ command: 'ps -axo pid,comm,%cpu,rss', explanation: 'Lists process IDs, executable names, CPU percentage, and memory in KiB on Linux and macOS.' }],
  },
  {
    id: 'port-owner', title: 'Find what is using a port', category: 'System', screen: 'ports',
    description: 'Look up local listeners and their process IDs.',
    explanation: 'When a development server says a port is already in use, inspect Ports for that number. TCP entries are listeners and UDP entries are bound sockets. Some operating systems hide another user’s process information.',
    examples: [
      { command: 'ss -lntup', explanation: 'On Linux, lists listening TCP and bound UDP sockets with process information when permitted.' },
      { command: 'lsof -nP -iTCP:3000 -sTCP:LISTEN', explanation: 'On macOS or Linux with lsof, finds the TCP listener on port 3000.' },
    ],
  },
  {
    id: 'read-logs', title: 'Read the end of a log file', category: 'Files', screen: 'files',
    description: 'Find a log and inspect its most recent lines.',
    explanation: 'Open a log in Files and switch the preview to its tail to see the newest entries. This is useful for recent errors in a large log. Refresh the preview when you want another snapshot.',
    examples: [
      { command: 'tail -n 50 -- app.log', explanation: 'Prints the last 50 lines of app.log on Linux.' },
      { command: 'tail -f app.log', explanation: 'Continuously prints newly appended lines; press Ctrl+C to stop following.' },
    ],
  },
  {
    id: 'project-scripts', title: 'Discover a project’s commands', category: 'Development', screen: 'scripts',
    description: 'Read named npm scripts and what they execute.',
    explanation: 'Scripts reads package.json in the folder you opened. Names such as dev, build, and test are shortcuts chosen by that project. Review the underlying command and trust the project before running a script.',
    examples: [
      { command: 'npm run', explanation: 'Lists the npm scripts available in the current package.' },
      { command: 'npm run test', explanation: 'Runs the project-defined test command, which can execute arbitrary project code.' },
    ],
  },
  {
    id: 'machine-overview', title: 'Understand your machine at a glance', category: 'System', screen: 'overview',
    description: 'Check platform, memory, CPU, and project context.',
    explanation: 'Overview gathers the machine and project facts you would otherwise inspect with several commands. Free memory is a system snapshot; it is not a diagnosis of an application problem.',
    examples: [
      { command: 'uname -s', explanation: 'Prints the operating-system kernel name on Linux and macOS.' },
      { command: 'uptime', explanation: 'Shows how long the machine has been running and its recent load on Unix systems.' },
    ],
  },
  {
    id: 'regex-basics', title: 'Use search patterns with confidence', category: 'Search', screen: 'search',
    description: 'Learn a few regular expressions for precise searches.',
    explanation: 'In regular-expression mode, ^ matches the start of a line, $ matches the end, and | means either alternative. For example, ^ERROR finds lines starting with ERROR. A literal dot must be escaped as \\. to avoid matching any character.',
    examples: [
      { command: 'grep -nE -- "^ERROR|^WARN" app.log', explanation: 'Finds log lines beginning with ERROR or WARN and includes their line numbers.' },
      { command: 'grep -nF -- "example.com" app.log', explanation: 'F treats the search as literal text, so the dot has no special meaning.' },
    ],
  },
];
