import sys

__payload = sys.stdin.read()
source = open(sys.argv[1]).read()
scope = {"__payload": __payload}
exec(source, scope)
print(scope["_result"])
