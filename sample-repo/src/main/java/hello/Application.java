package hello;

import java.io.IOException;
import java.net.Socket;

public class Application {

	public static void main(String[] args) {
		Socket socket = new Socket();
		try {
			Library.doSomething(socket.getInputStream());
		} catch (IOException e) {
			// do nothing
		}
	}
}
