package dev.webswitcher.fetcher;

import java.net.InetAddress;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import static org.junit.jupiter.api.Assertions.*;

class AddressPolicyTest {
    static Stream<String> forbidden() {
        return Stream.of("0.0.0.0", "0.1.2.3", "10.1.2.3", "100.64.0.1", "100.127.255.255", "127.0.0.1",
                "169.254.169.254", "172.16.0.1", "172.31.255.1", "192.168.1.1", "192.0.0.8", "192.0.2.1",
                "198.18.0.1", "198.19.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.1.2.3", "255.255.255.255",
                "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1", "2001::1",
                "2002:7f00:1::1", "64:ff9b::7f00:1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "3fff::1");
    }
    @ParameterizedTest @MethodSource("forbidden") void rejectsSpecialPurpose(String ip) throws Exception {
        assertThrows(IllegalArgumentException.class, () -> AddressPolicy.requirePublic(InetAddress.getByName(ip)));
    }
    @Test void acceptsPublicUnicast() throws Exception {
        for (String ip : new String[]{"1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"})
            assertDoesNotThrow(() -> AddressPolicy.requirePublic(InetAddress.getByName(ip)));
    }
    @Test void rejectsMixedDnsAndPreservesInputOwnership() throws Exception {
        InetAddress[] mixed = {InetAddress.getByName("1.1.1.1"), InetAddress.getByName("10.0.0.1")};
        assertThrows(IllegalArgumentException.class, () -> AddressPolicy.requireAllPublic(mixed));
        InetAddress[] valid = {InetAddress.getByName("1.1.1.1")};
        assertNotSame(valid, AddressPolicy.requireAllPublic(valid));
        assertThrows(IllegalArgumentException.class, () -> AddressPolicy.requireAllPublic(new InetAddress[0]));
    }
}
