#!/bin/sh
# Rebuild public/cli-docs.js for every release.
#   ./build_all.sh <Command-Line-Reference.pdf> <clihelp-5.2.txt> <clihelp-5.3.txt>
set -e
cd "$(dirname "$0")"
pdftotext -layout "$1" ref.txt
python3 parse.py ref.txt > /dev/null
python3 parse_help.py "$2" 5.2
python3 parse_help.py "$3" 5.3
RELEASE=5.2 RESTRICT=1 python3 build.py > build-5.2.log; head -1 build-5.2.log
RELEASE=5.3 python3 build.py > build-5.3.log; head -1 build-5.3.log
python3 combine.py
rm -f ref.txt cli.json cli_help_*.json cli_docs_*.json
echo "Options that could not be mapped to API fields: build-5.2.log, build-5.3.log"
