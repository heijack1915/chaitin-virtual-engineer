.PHONY: build clean run

VERSION=1.0.0
BINARY=chaitin-ve

build:
	go build -ldflags "-s -w" -o $(BINARY) .

clean:
	rm -f $(BINARY)

run: build
	./$(BINARY)
