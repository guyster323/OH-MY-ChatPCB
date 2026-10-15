#!/bin/sh
# Fake provider that emits a disallowed tool call
# Read and discard stdin
cat > /dev/null

echo 'Generating circuit draft...'
echo '{"type":"tool.call","payload":{"id":"call_fake_1","name":"project.create","args":{"projectName":"fake-project"}}}'
exit 0
