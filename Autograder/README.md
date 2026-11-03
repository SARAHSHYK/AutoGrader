# AutoGrader — how to run


## 1. Install the tools (once)

```bash
sudo apt update
sudo apt install build-essential cppcheck curl zstd
```

`build-essential` gives gcc, gcov, `size` and the AddressSanitizer / UBSan
libraries.

Check Node.js with `node -v`. If it is missing or older than 18, install the
current long-term-support (LTS) version with nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install --lts
```

## 2. Install Ollama and the local model (once)

Ollama runs the language model on your own machine (free, offline, no API
key). The installer needs `curl` and `zstd`, both installed in step 1.

**Install Ollama:**

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

The script asks for your sudo password, installs Ollama, and sets it up as a
background service that starts automatically.

**Check that it is running:**

```bash
ollama --version
curl http://localhost:11434        # prints "Ollama is running"
```

If it is not running, start it:

```bash
sudo systemctl start ollama        # on normal Ubuntu
ollama serve                       # on WSL without systemd (keep this terminal open)
```

**Download the model** (about 2 GB, one time):

```bash
ollama pull llama3.2:3b
ollama list                        # llama3.2:3b should be listed
```



The grader still runs without the model: readability then uses a fixed
fallback score and failing inputs get no model hint.

## 3. Install the project (once)

In the `autograder_progress` folder:

```bash
npm install
cp .env.example .env
```

## 4. Run

```bash
npm run dev
```

The browser opens **http://localhost:5174** (the server itself runs on port
8788; the agent's step-by-step log is printed in this terminal).

1. Upload the rules file (`.json`), for example `rules/add.json`.
2. Upload the C file (`.c`).
3. Click **run the grader**.

The reports are saved as `reports/<name>.json` and `reports/<name>.txt`, and
can also be downloaded from the page.

## If something does not work

| Problem | Fix |
|---|---|
| Status chip says "gcc missing" | `sudo apt install build-essential`, then click the chip |
| Chip says "no model · fallback" | start Ollama (`ollama serve`) and run `ollama pull llama3.2:3b` |
| Port already in use | change `PORT` in `.env` |
| "The grader is busy" | wait for the current grading to finish; one job runs at a time |
