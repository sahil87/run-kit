PREFIX ?= /usr/local
HOMEBREW_PREFIX := $(shell brew --prefix 2>/dev/null || echo /opt/homebrew)
LIBVNC_PREFIX := $(shell brew --prefix libvncserver 2>/dev/null || echo $(HOMEBREW_PREFIX))

CFLAGS := -O2 -Wall -fobjc-arc \
	-I$(LIBVNC_PREFIX)/include \
	-I. \
	-framework CoreGraphics \
	-framework CoreMedia \
	-framework CoreVideo \
	-framework Foundation \
	-framework IOSurface \
	-framework ScreenCaptureKit \
	-framework ApplicationServices

LDFLAGS := -L$(LIBVNC_PREFIX)/lib -lvncserver

BIN := rk-virtual-display

all: $(BIN)

$(BIN): main.m CGVirtualDisplayPrivate.h
	clang $(CFLAGS) $(LDFLAGS) -o $@ main.m

DIST_DIR := ../../dist

install: $(BIN)
	mkdir -p $(DIST_DIR)
	install -m 755 $(BIN) $(DIST_DIR)/

clean:
	rm -f $(BIN)

.PHONY: all install clean
