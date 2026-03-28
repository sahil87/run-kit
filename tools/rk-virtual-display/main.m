// rk-virtual-display: Creates a macOS virtual display and serves it over VNC.
//
// Usage: rk-virtual-display --width 1920 --height 1080 --port 58687
//
// Creates a virtual display using CGVirtualDisplay (private API), captures frames
// via CGDisplayStream, and serves them over VNC using libvncserver. Mouse and
// keyboard input from VNC clients is forwarded to the virtual display via CGEvent.
//
// The process runs until killed (SIGTERM/SIGINT). The virtual display is destroyed
// when the process exits (ARC releases the CGVirtualDisplay object).

#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <IOSurface/IOSurface.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import "CGVirtualDisplayPrivate.h"
#include <rfb/rfb.h>
#include <signal.h>

// Globals for the VNC server and display state
static rfbScreenInfoPtr rfbScreen = NULL;
static CGVirtualDisplay *virtualDisplay = nil;
static volatile sig_atomic_t shouldQuit = 0;
static int displayWidth = 1920;
static int displayHeight = 1080;
// Virtual display origin in global coordinate space (set after display creation)
static CGFloat displayOriginX = 0;
static CGFloat displayOriginY = 0;

// Lock for framebuffer updates
static pthread_mutex_t fbMutex = PTHREAD_MUTEX_INITIALIZER;

#pragma mark - ScreenCaptureKit Stream Output Delegate

API_AVAILABLE(macos(12.3))
@interface RKStreamOutput : NSObject <SCStreamOutput>
@end

@implementation RKStreamOutput
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
    if (type != SCStreamOutputTypeScreen) return;
    if (!rfbScreen || !rfbScreen->frameBuffer) return;

    CVImageBufferRef imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (!imageBuffer) return;

    CVPixelBufferLockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);

    void *baseAddr = CVPixelBufferGetBaseAddress(imageBuffer);
    size_t bytesPerRow = CVPixelBufferGetBytesPerRow(imageBuffer);
    size_t surfaceWidth = CVPixelBufferGetWidth(imageBuffer);
    size_t surfaceHeight = CVPixelBufferGetHeight(imageBuffer);

    pthread_mutex_lock(&fbMutex);

    size_t copyWidth = (surfaceWidth < (size_t)displayWidth) ? surfaceWidth : (size_t)displayWidth;
    size_t copyHeight = (surfaceHeight < (size_t)displayHeight) ? surfaceHeight : (size_t)displayHeight;
    size_t dstBytesPerRow = (size_t)displayWidth * 4;

    for (size_t row = 0; row < copyHeight; row++) {
        memcpy(rfbScreen->frameBuffer + row * dstBytesPerRow,
               (char *)baseAddr + row * bytesPerRow,
               copyWidth * 4);
    }

    rfbMarkRectAsModified(rfbScreen, 0, 0, (int)copyWidth, (int)copyHeight);
    pthread_mutex_unlock(&fbMutex);

    CVPixelBufferUnlockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);
}
@end

#pragma mark - Input Handling

// Convert VNC mouse button mask to CGEventType and CGMouseButton
static void handlePointerEvent(int buttonMask, int x, int y, rfbClientPtr cl) {
    (void)cl;
    static int lastButtonMask = 0;
    // VNC sends coordinates in virtual display space (0..width, 0..height).
    // CGEventPost needs global screen coordinates, so offset by the display origin.
    CGPoint point = CGPointMake(x + displayOriginX, y + displayOriginY);

    // Move event
    CGEventRef moveEvent = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, point, kCGMouseButtonLeft);
    if (moveEvent) {
        CGEventPost(kCGHIDEventTap, moveEvent);
        CFRelease(moveEvent);
    }

    // Button press/release
    for (int i = 0; i < 3; i++) {
        int mask = 1 << i;
        BOOL wasDown = (lastButtonMask & mask) != 0;
        BOOL isDown = (buttonMask & mask) != 0;

        if (wasDown == isDown) continue;

        CGEventType type;
        CGMouseButton button;
        switch (i) {
            case 0: // Left
                button = kCGMouseButtonLeft;
                type = isDown ? kCGEventLeftMouseDown : kCGEventLeftMouseUp;
                break;
            case 1: // Middle
                button = kCGMouseButtonCenter;
                type = isDown ? kCGEventOtherMouseDown : kCGEventOtherMouseUp;
                break;
            case 2: // Right
                button = kCGMouseButtonRight;
                type = isDown ? kCGEventRightMouseDown : kCGEventRightMouseUp;
                break;
            default: continue;
        }

        CGEventRef event = CGEventCreateMouseEvent(NULL, type, point, button);
        if (event) {
            CGEventPost(kCGHIDEventTap, event);
            CFRelease(event);
        }
    }

    // Scroll wheel (buttons 4/5 in VNC)
    if (buttonMask & (1 << 3)) { // Scroll up
        CGEventRef scroll = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 1, 3);
        if (scroll) { CGEventPost(kCGHIDEventTap, scroll); CFRelease(scroll); }
    }
    if (buttonMask & (1 << 4)) { // Scroll down
        CGEventRef scroll = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 1, -3);
        if (scroll) { CGEventPost(kCGHIDEventTap, scroll); CFRelease(scroll); }
    }

    lastButtonMask = buttonMask;
}

static void handleKeyEvent(rfbBool down, rfbKeySym keySym, rfbClientPtr cl) {
    (void)cl;
    // Map X11 keysym to macOS virtual keycode
    // For simplicity, use CGEventCreateKeyboardEvent with keycode 0
    // and set the Unicode character via CGEventKeyboardSetUnicodeString
    CGEventRef event = CGEventCreateKeyboardEvent(NULL, 0, down ? true : false);
    if (!event) return;

    // Handle basic ASCII keysyms
    if (keySym >= 0x20 && keySym <= 0x7E) {
        UniChar ch = (UniChar)keySym;
        CGEventKeyboardSetUnicodeString(event, 1, &ch);
    } else if (keySym == 0xFF0D) { // Return
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 36, down);
    } else if (keySym == 0xFF08) { // Backspace
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 51, down);
    } else if (keySym == 0xFF09) { // Tab
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 48, down);
    } else if (keySym == 0xFF1B) { // Escape
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 53, down);
    } else if (keySym == 0xFF51) { // Left arrow
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 123, down);
    } else if (keySym == 0xFF52) { // Up arrow
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 126, down);
    } else if (keySym == 0xFF53) { // Right arrow
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 124, down);
    } else if (keySym == 0xFF54) { // Down arrow
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 125, down);
    } else if (keySym == 0xFFFF) { // Delete
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 117, down);
    } else if (keySym == 0xFF50) { // Home
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 115, down);
    } else if (keySym == 0xFF57) { // End
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 119, down);
    } else if (keySym >= 0xFFBE && keySym <= 0xFFC9) { // F1-F12
        int fkey = keySym - 0xFFBE;
        int keycodes[] = {122,120,99,118,96,97,98,100,101,109,103,111};
        if (fkey < 12) {
            CFRelease(event);
            event = CGEventCreateKeyboardEvent(NULL, keycodes[fkey], down);
        }
    } else if (keySym == 0xFFE1 || keySym == 0xFFE2) { // Shift
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 56, down);
    } else if (keySym == 0xFFE3 || keySym == 0xFFE4) { // Control
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 59, down);
    } else if (keySym == 0xFFE9 || keySym == 0xFFEA) { // Alt/Option
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 58, down);
    } else if (keySym == 0xFFE7 || keySym == 0xFFE8) { // Meta/Command
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 55, down);
    } else if (keySym == 0x20) { // Space
        CFRelease(event);
        event = CGEventCreateKeyboardEvent(NULL, 49, down);
    }

    if (event) {
        CGEventPost(kCGHIDEventTap, event);
        CFRelease(event);
    }
}

#pragma mark - Signal Handling

static void signalHandler(int sig) {
    (void)sig;
    shouldQuit = 1;
}

#pragma mark - Main

static void printUsage(const char *name) {
    fprintf(stderr, "Usage: %s --width W --height H --port P\n", name);
    fprintf(stderr, "Creates a virtual display and serves it over VNC.\n");
}

int main(int argc, char *argv[]) {
    @autoreleasepool {
        int port = 0;
        int width = 1920;
        int height = 1080;

        // Parse arguments
        for (int i = 1; i < argc; i++) {
            if (strcmp(argv[i], "--width") == 0 && i + 1 < argc) {
                width = atoi(argv[++i]);
            } else if (strcmp(argv[i], "--height") == 0 && i + 1 < argc) {
                height = atoi(argv[++i]);
            } else if (strcmp(argv[i], "--port") == 0 && i + 1 < argc) {
                port = atoi(argv[++i]);
            } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
                printUsage(argv[0]);
                return 0;
            }
        }

        if (port <= 0 || width <= 0 || height <= 0) {
            printUsage(argv[0]);
            return 1;
        }

        displayWidth = width;
        displayHeight = height;

        // Set up signal handlers
        signal(SIGINT, signalHandler);
        signal(SIGTERM, signalHandler);

        // --- Step 1: Create Virtual Display ---
        CGVirtualDisplayDescriptor *desc = [[CGVirtualDisplayDescriptor alloc] init];
        [desc setDispatchQueue:dispatch_get_main_queue()];
        desc.name = [NSString stringWithFormat:@"run-kit Desktop (%dx%d)", width, height];
        desc.maxPixelsWide = width;
        desc.maxPixelsHigh = height;
        desc.sizeInMillimeters = CGSizeMake(width * 0.28, height * 0.28); // ~0.28mm/px ≈ 91 DPI
        desc.vendorID = 0x4B01;
        desc.productID = 0x0001;
        desc.serialNum = (unsigned int)(port & 0xFFFF);

        virtualDisplay = [[CGVirtualDisplay alloc] initWithDescriptor:desc];
        if (!virtualDisplay) {
            fprintf(stderr, "ERROR: Failed to create virtual display. macOS 14+ required.\n");
            return 1;
        }

        // Configure display mode
        CGVirtualDisplayMode *mode = [[CGVirtualDisplayMode alloc] initWithWidth:width height:height refreshRate:60];
        CGVirtualDisplaySettings *settings = [[CGVirtualDisplaySettings alloc] init];
        settings.modes = @[mode];
        settings.hiDPI = 0;

        if (![virtualDisplay applySettings:settings]) {
            fprintf(stderr, "ERROR: Failed to apply display settings.\n");
            return 1;
        }

        CGDirectDisplayID displayID = virtualDisplay.displayID;
        fprintf(stderr, "Virtual display created: ID=%u resolution=%dx%d\n", displayID, width, height);

        // Check Accessibility permission (needed for CGEventPost to inject input)
        NSDictionary *opts = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
        Boolean trusted = AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)opts);
        if (!trusted) {
            fprintf(stderr, "WARNING: Accessibility permission not granted. Mouse/keyboard input will not work.\n");
            fprintf(stderr, "Grant access in: System Settings > Privacy & Security > Accessibility\n");
        }

        // Brief pause for display to initialize, then read its position in global space
        usleep(500000);

        CGRect displayBounds = CGDisplayBounds(displayID);
        displayOriginX = displayBounds.origin.x;
        displayOriginY = displayBounds.origin.y;
        fprintf(stderr, "Display origin in global space: (%.0f, %.0f)\n", displayOriginX, displayOriginY);

        // --- Step 2: Set up VNC Server ---
        rfbScreen = rfbGetScreen(NULL, NULL, width, height, 8, 3, 4);
        if (!rfbScreen) {
            fprintf(stderr, "ERROR: Failed to create VNC server.\n");
            return 1;
        }

        rfbScreen->port = port;
        rfbScreen->ipv6port = port;

        // ScreenCaptureKit delivers BGRA: B at byte 0, G at 1, R at 2, A at 3.
        // Tell libvncserver the correct shifts so VNC clients render colors correctly.
        rfbScreen->serverFormat.redShift   = 16;
        rfbScreen->serverFormat.greenShift = 8;
        rfbScreen->serverFormat.blueShift  = 0;
        rfbScreen->alwaysShared = TRUE;
        rfbScreen->desktopName = "run-kit Desktop";
        rfbScreen->ptrAddEvent = handlePointerEvent;
        rfbScreen->kbdAddEvent = handleKeyEvent;

        // Allocate framebuffer
        rfbScreen->frameBuffer = (char *)calloc(width * height * 4, 1);
        if (!rfbScreen->frameBuffer) {
            fprintf(stderr, "ERROR: Failed to allocate framebuffer.\n");
            return 1;
        }

        rfbInitServer(rfbScreen);
        fprintf(stderr, "VNC server listening on port %d\n", port);

        // Print machine-readable info to stdout for the Go backend
        printf("{\"displayID\":%u,\"port\":%d,\"width\":%d,\"height\":%d}\n", displayID, port, width, height);
        fflush(stdout);

        // --- Step 3: Start Display Capture via ScreenCaptureKit ---
        __block SCStream *captureStream = nil;
        RKStreamOutput *streamOutput = [[RKStreamOutput alloc] init];
        dispatch_queue_t captureQueue = dispatch_queue_create("rk.capture", DISPATCH_QUEUE_SERIAL);

        // Find the SCDisplay matching our virtual display ID
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);
        __block NSError *setupError = nil;

        [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent *content, NSError *error) {
            if (error || !content) {
                setupError = error ?: [NSError errorWithDomain:@"rk" code:1 userInfo:@{NSLocalizedDescriptionKey: @"No shareable content"}];
                dispatch_semaphore_signal(sem);
                return;
            }

            SCDisplay *targetDisplay = nil;
            for (SCDisplay *d in content.displays) {
                if (d.displayID == displayID) {
                    targetDisplay = d;
                    break;
                }
            }

            if (!targetDisplay) {
                setupError = [NSError errorWithDomain:@"rk" code:2 userInfo:@{NSLocalizedDescriptionKey: @"Virtual display not found in ScreenCaptureKit"}];
                dispatch_semaphore_signal(sem);
                return;
            }

            // Create filter for just our display
            SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:targetDisplay excludingWindows:@[]];

            SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
            config.width = width;
            config.height = height;
            config.minimumFrameInterval = CMTimeMake(1, 30); // 30 FPS
            config.pixelFormat = kCVPixelFormatType_32BGRA;
            config.showsCursor = YES;

            captureStream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:nil];

            NSError *addErr = nil;
            [captureStream addStreamOutput:streamOutput type:SCStreamOutputTypeScreen sampleHandlerQueue:captureQueue error:&addErr];
            if (addErr) {
                setupError = addErr;
                dispatch_semaphore_signal(sem);
                return;
            }

            [captureStream startCaptureWithCompletionHandler:^(NSError *startErr) {
                setupError = startErr;
                dispatch_semaphore_signal(sem);
            }];
        }];

        dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));

        if (setupError) {
            fprintf(stderr, "ERROR: Screen capture setup failed: %s\n",
                    [[setupError localizedDescription] UTF8String]);
            fprintf(stderr, "Grant Screen Recording permission in System Settings > Privacy & Security.\n");
            return 1;
        }

        fprintf(stderr, "Display capture started (30 FPS via ScreenCaptureKit)\n");

        // --- Step 4: Run Loop ---
        // Process VNC events on main thread, capture arrives on captureQueue
        while (!shouldQuit) {
            long timeout = rfbScreen->clientHead ? 10000 : 100000; // 10ms active, 100ms idle
            rfbProcessEvents(rfbScreen, timeout);
        }

        // --- Cleanup ---
        fprintf(stderr, "Shutting down...\n");
        if (captureStream) {
            dispatch_semaphore_t stopSem = dispatch_semaphore_create(0);
            [captureStream stopCaptureWithCompletionHandler:^(NSError *err) {
                (void)err;
                dispatch_semaphore_signal(stopSem);
            }];
            dispatch_semaphore_wait(stopSem, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
        }
        if (rfbScreen) {
            free(rfbScreen->frameBuffer);
            rfbScreenCleanup(rfbScreen);
        }
        virtualDisplay = nil; // ARC releases → display destroyed

        return 0;
    }
}
