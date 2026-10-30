package dev.webswitcher.fetcher;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PinnedHttpTransportTest {
    @Test void actualConnectionMustBePublicAndInValidatedDnsSet() throws Exception {
        InetAddress[] pinned = {InetAddress.getByName("1.1.1.1")};
        assertDoesNotThrow(() -> PinnedHttpTransport.requirePinnedRemote(new InetSocketAddress("1.1.1.1", 443), pinned));
        assertThrows(IOException.class, () -> PinnedHttpTransport.requirePinnedRemote(new InetSocketAddress("8.8.8.8", 443), pinned));
        assertThrows(IOException.class, () -> PinnedHttpTransport.requirePinnedRemote(new InetSocketAddress("127.0.0.1", 443), pinned));
        assertThrows(IOException.class, () -> PinnedHttpTransport.requirePinnedRemote(new InetSocketAddress("1.1.1.1", 8443), pinned));
        assertThrows(IOException.class, () -> PinnedHttpTransport.requirePinnedRemote(InetSocketAddress.createUnresolved("example.org", 443), pinned));
        assertThrows(IOException.class, () -> PinnedHttpTransport.requirePinnedRemote(null, pinned));
    }
}
